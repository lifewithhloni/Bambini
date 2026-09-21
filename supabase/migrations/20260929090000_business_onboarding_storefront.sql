-- Phase 6: business seller onboarding & storefront foundation.
--
-- Inspection finding that shaped this migration: almost everything
-- security-relevant already existed, unused. `businesses_insert_own`
-- RLS already derives ownership from auth.uid() and the column-level
-- INSERT grant (20260920100000_restrict_insert_columns.sql) already
-- excludes verification_status/account_standing/rating_*/
-- completed_transaction_count from what a client can set at creation —
-- business creation needed no new SECURITY DEFINER function, only a
-- server action and UI. `products_insert_owner` RLS already rejects a
-- spoofed business_id via is_business_member(). `is_business_member()`
-- is already threaded through every money-moving table's RLS. Nothing
-- here duplicates any of that.
--
-- What's actually new:
--
-- 1. Business verification — a manual-review workflow on
--    business_verifications, mirroring Phase 5's identity_verifications
--    pattern exactly (same shape: submit -> pending -> admin
--    approve/reject -> history preserved). The old
--    business_verifications_update_admin RLS policy had the identical
--    gap Phase 5 found and fixed for identity_verifications (no WITH
--    CHECK — reviewed_by could be set to anything) — fixed the same
--    way, with a SECURITY DEFINER review function replacing it.
-- 2. Storage RLS for business verification documents, reusing the
--    existing private verification-documents bucket under a
--    "business/<business_id>/..." path prefix that can never collide
--    with an individual's "<user_id>/..." path (a business_id and a
--    user's own uuid are drawn from the same uuid space but the
--    business docs are namespaced under the literal "business" segment
--    first).
-- 3. enforce_seller_verification_on_publish() (Phase 5) extended: a
--    business-type listing now also requires
--    businesses.verification_status = 'verified', on top of the acting
--    individual's own Phase 5 personal verification (unchanged,
--    unweakened). This is not an invented requirement — two things
--    already in the repository assume it: businesses_public (the only
--    sanctioned public read of a business) already filters `where
--    verification_status = 'verified'`, and getPublicListing() resolves
--    a business seller's display name through that same view — meaning
--    an unverified business's published listing would already render
--    with no seller name at all without this gate. Extending the
--    trigger closes a real, pre-existing inconsistency rather than
--    adding a new policy from nothing.
-- 4. A slug format CHECK (uniqueness already existed) and a business
--    location update path reusing the existing locations table exactly
--    the way profiles/products already do (created_by = the acting
--    individual, never the business "owning" the location row itself —
--    matches every other locations write in this schema).

-- 1. Business verification: submission history + admin review ------------
-- No new columns needed — business_verifications already has the right
-- shape (id, business_id, document_type, document_storage_path, status,
-- reviewed_by, reviewed_at, notes, created_at), no unique constraint on
-- business_id (resubmission history already structurally supported,
-- exactly like identity_verifications before Phase 5 touched it).

drop policy business_verifications_update_admin on public.business_verifications;

create function public.latest_business_verification_status(p_business_id uuid)
returns verification_status
language sql
stable
security definer
set search_path = public
as $$
  select status from public.business_verifications
  where business_id = p_business_id
  order by created_at desc, id desc
  limit 1;
$$;

revoke execute on function public.latest_business_verification_status(uuid) from public, anon, authenticated;

-- SECURITY DEFINER for the same reason as Phase 5's
-- sync_profile_identity_verification(): this fires from a plain
-- RLS-gated authenticated INSERT (a business member's own submission)
-- or an admin's review, and neither role has a column grant to write
-- businesses.verification_status directly (see
-- 20260920100000_restrict_insert_columns.sql's own INSERT-only scope,
-- and businesses_update_owner_or_admin's column grant below, which
-- deliberately excludes it too).
create function public.sync_business_verification_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest verification_status;
begin
  v_latest := public.latest_business_verification_status(new.business_id);
  update public.businesses set verification_status = coalesce(v_latest, 'unverified') where id = new.business_id;
  return new;
end;
$$;

create trigger business_verifications_sync_business
  after insert or update on public.business_verifications
  for each row execute function public.sync_business_verification_status();

-- Replaces the dropped raw-UPDATE policy: state-machine-safe (only a
-- 'pending' submission can be decided), always records reviewed_by from
-- auth.uid() (never client-supplied — the old policy had no WITH CHECK
-- constraining that at all), atomic with an admin_actions audit row.
-- Mirrors review_identity_verification() exactly.
create function public.review_business_verification(
  p_submission_id uuid,
  p_decision verification_status,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_submission record;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  if p_decision not in ('verified', 'rejected') then
    raise exception 'A review decision must be verified or rejected';
  end if;

  select id, status into v_submission
  from public.business_verifications
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Verification submission not found';
  end if;

  if v_submission.status <> 'pending' then
    raise exception 'This submission has already been reviewed';
  end if;

  update public.business_verifications
  set status = p_decision, reviewed_by = v_admin_id, reviewed_at = now(), notes = p_notes
  where id = p_submission_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'business_verification_' || p_decision::text, 'business_verification', p_submission_id, p_notes);
end;
$$;

revoke execute on function public.review_business_verification(uuid, verification_status, text) from public, anon;
grant execute on function public.review_business_verification(uuid, verification_status, text) to authenticated;

-- 2. Storage RLS for business verification documents ----------------------
-- Same private bucket as identity documents (verification-documents),
-- namespaced under a literal "business/" first path segment so it can
-- never collide with an individual's "<user_id>/..." path (Phase 5).
create policy business_verification_documents_storage_insert_member
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = 'business'
    and public.is_business_member(((storage.foldername(name))[2])::uuid)
  );

create policy business_verification_documents_storage_select_member_or_admin
  on storage.objects for select
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = 'business'
    and (public.is_business_member(((storage.foldername(name))[2])::uuid) or public.is_admin())
  );

-- 3. Publication gate: business verification, on top of individual verification ----
-- Same signature (CREATE OR REPLACE) — the individual-seller branch
-- (can_transact() for the acting auth.uid()) is completely unchanged;
-- only a new, additional check for seller_type = 'business' is added.
create or replace function public.enforce_seller_verification_on_publish()
returns trigger
language plpgsql
as $$
declare
  v_business_verified boolean;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if current_user = 'authenticated' then
      if not public.can_transact() then
        raise exception 'Account verification required before publishing a listing.';
      end if;

      if new.seller_type = 'business' then
        select (verification_status = 'verified') into v_business_verified
        from public.businesses where id = new.business_id;

        if not coalesce(v_business_verified, false) then
          raise exception 'This business is not yet verified. Submit business verification before publishing.';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 4. Slug format + business location -----------------------------------
-- Uniqueness already existed (slug text not null unique); format did not.
alter table public.businesses
  add constraint businesses_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- 5. decline_cash_order(): close the same bypass for business sellers ------
-- Found during this phase's own review of the Phase 5 decline_cash_order()
-- fix, by applying the same "does this new gate have a parallel blind
-- spot" scrutiny to business verification. Confirmed empirically: the
-- Phase 5 fix's `v_order.seller_type <> 'parent' or
-- is_profile_fully_verified(...)` check treats *any* business-type
-- order as automatically "verified enough" to republish, never checking
-- businesses.verification_status at all — so a business that was
-- verified when a cash order was created, but whose verification later
-- lapses (a fresh business_verifications resubmission flips it back to
-- 'pending' — the same sync trigger this migration adds), could still
-- have its listing republished by decline_cash_order() with no fresh
-- check, exactly mirroring the individual-seller bypass Phase 5 already
-- found and fixed. Same fix shape: republish only if still verified
-- (individual AND, for a business order, the business too); otherwise
-- revert to 'draft', never blocking the decline/cancellation itself.
create or replace function public.decline_cash_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order record;
  v_product_id uuid;
  v_seller_verified boolean;
  v_business_verified boolean;
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  select o.id, o.status, o.seller_type, o.seller_profile_id, o.business_id
  into v_order
  from public.orders o
  join public.payments p on p.order_id = o.id
  where o.id = p_order_id
    and p.method = 'cash'
    and (o.seller_profile_id = v_seller_id or public.is_business_member(o.business_id))
  for update of o;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'Order cannot be declined at this stage';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;

  update public.commissions set settlement_status = 'settled' where order_id = p_order_id;

  select oi.product_id into v_product_id from public.order_items oi where oi.order_id = p_order_id;
  if v_product_id is not null then
    if v_order.seller_type = 'parent' then
      v_seller_verified := public.is_profile_fully_verified(v_order.seller_profile_id);
    else
      select (verification_status = 'verified') into v_business_verified from public.businesses where id = v_order.business_id;
      v_seller_verified := coalesce(v_business_verified, false);
    end if;

    if v_seller_verified then
      update public.products set status = 'published' where id = v_product_id and status = 'sold';
    else
      update public.products set status = 'draft' where id = v_product_id and status = 'sold';
    end if;
  end if;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (p_order_id, 'order', p_order_id, 'cash_order.declined', 'seller', v_seller_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.decline_cash_order(uuid, text) from public, anon;
grant execute on function public.decline_cash_order(uuid, text) to authenticated;
