-- Phase 14B: harden the existing messaging tables so buyer <-> seller
-- conversations are safe to build on.
--
-- message_threads and messages have existed since the foundation schema
-- (20260920090900_messaging_and_reviews.sql) with participant-scoped
-- SELECT policies that are correct and are kept exactly as they are:
-- buyer, parent seller, or any member of the selling business (the same
-- is_business_member() precedent used for seller operational actions
-- elsewhere; business_members.role is NOT consulted). No new tables are
-- needed. What was missing — each proven by tests/db/messaging.test.ts
-- failing before this migration — is below.
--
-- 1. THREAD CREATION TRUSTED THE CLIENT. message_threads_insert_buyer only
--    checked buyer_id = auth.uid(). Any signed-in user could open a thread
--    naming ANY seller or business and any product (or none), dropping
--    unsolicited conversations into a stranger's inbox with forged listing
--    context, message themselves about their own listing, or attach a
--    draft/archived listing. The policy now requires the referenced
--    product to be currently published, the thread's seller identity to
--    match the product's own seller exactly, and the buyer not to be that
--    seller (parent) nor any member/owner of that business. A thread with
--    no product is no longer creatable directly (product_id still becomes
--    NULL later if the listing is deleted — ON DELETE SET NULL — and such
--    a thread simply keeps its history).
--
-- 2. NO UNIQUENESS. Nothing stopped unlimited duplicate threads for the
--    same buyer and listing, or a race creating two at once. A plain
--    (buyer_id, product_id) unique index fixes both; NULL product_ids
--    (deleted-listing threads) are distinct so they never collide, and a
--    non-partial index lets the app use INSERT ... ON CONFLICT DO NOTHING.
--
-- 3. MESSAGES WERE CLIENT-AUTHORED IN EVERY COLUMN. The INSERT grant
--    covered every column (a client could backdate created_at or send a
--    message pre-marked read) and messages_update_recipient_mark_read let
--    any participant UPDATE any column of any message — rewrite another
--    person's body, change sender_id, un-read a message. INSERT is now
--    limited to (thread_id, sender_id, body); UPDATE to read_at only, and
--    only by the RECIPIENT (not the sender), so timestamps, sender, and
--    body are database-authoritative and immutable.
--
-- 4. BODY RULES. The only constraint was char_length > 0, so "   " was a
--    valid message and length was unbounded. Whitespace-only and > 2000
--    characters are now rejected by the database, independent of the app.
--
-- 5. last_message_at NEVER UPDATED. Nothing maintained it, so an inbox
--    ordered by recency would have been ordered by creation time. A
--    SECURITY DEFINER trigger bumps it on message insert (participants
--    have no UPDATE policy on threads, deliberately, so they can't set it
--    themselves).
--
-- No policy is broadened, no service-role access is introduced, and no
-- DELETE policy exists or is added on either table.

-- 2. one conversation per buyer per listing --------------------------------
create unique index message_threads_buyer_product_key
  on public.message_threads (buyer_id, product_id);

-- 1. thread creation ------------------------------------------------------
drop policy message_threads_insert_buyer on public.message_threads;

create policy message_threads_insert_buyer_about_listing on public.message_threads
  for insert with check (
    buyer_id = auth.uid()
    and product_id is not null
    and exists (
      select 1 from public.products p
      where p.id = message_threads.product_id
        and p.status = 'published'
        and p.seller_type = message_threads.seller_type
        and p.seller_profile_id is not distinct from message_threads.seller_profile_id
        and p.business_id is not distinct from message_threads.business_id
    )
    and (message_threads.seller_profile_id is null or message_threads.seller_profile_id <> auth.uid())
    and (message_threads.business_id is null or not public.is_business_member(message_threads.business_id))
  );

revoke insert on public.message_threads from authenticated;
grant insert (product_id, buyer_id, seller_type, seller_profile_id, business_id) on public.message_threads to authenticated;

-- 3. message column authority --------------------------------------------
revoke insert on public.messages from authenticated;
grant insert (thread_id, sender_id, body) on public.messages to authenticated;

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

drop policy messages_update_recipient_mark_read on public.messages;

create policy messages_update_recipient_mark_read on public.messages
  for update
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id
        and (t.buyer_id = auth.uid() or t.seller_profile_id = auth.uid() or public.is_business_member(t.business_id))
    )
  )
  with check (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id
        and (t.buyer_id = auth.uid() or t.seller_profile_id = auth.uid() or public.is_business_member(t.business_id))
    )
  );

-- 4. body rules -----------------------------------------------------------
-- btrim() alone only strips spaces, so a body of tabs/newlines would pass;
-- require at least one non-whitespace character instead.
alter table public.messages add constraint messages_body_not_blank check (body ~ '[^[:space:]]');
alter table public.messages add constraint messages_body_max_length check (char_length(body) <= 2000);

-- 5. keep last_message_at current ----------------------------------------
create function public.bump_message_thread_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.message_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$$;

revoke all on function public.bump_message_thread_last_message_at() from public, anon, authenticated;

create trigger messages_bump_thread_last_message_at
  after insert on public.messages
  for each row execute function public.bump_message_thread_last_message_at();
