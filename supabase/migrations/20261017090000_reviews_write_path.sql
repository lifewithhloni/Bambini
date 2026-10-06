-- Phase 15B.1 — Reviews MVP: a safe write path, a correct rating cache, and a
-- public representation that doesn't leak who bought what.
--
-- The model is unchanged and already in the schema (20260920090900): ONE
-- review per COMPLETED order, written by that order's BUYER about the
-- order's seller (a parent profile or a business). This migration fixes
-- what the Phase 15B audit found broken or unsafe about it:
--
--   * The only way in was a direct client INSERT whose RLS policy checked
--     the order's buyer/status but never that the seller columns matched
--     the order (any seller could be rated), and let the client set
--     seller_response and created_at. -> create_review() is now the ONLY
--     write path; clients have no INSERT/UPDATE/DELETE on the table.
--   * The rating-cache trigger wasn't SECURITY DEFINER, so it failed with
--     "permission denied for table profiles" for every real buyer (no review
--     could ever be created), and it incremented the cache (rounding drift,
--     no way to handle hiding). -> definer, fixed search_path, and it
--     RECOMPUTES count/average from the visible review rows.
--   * comment had no size/blank validation. -> checked here and in
--     create_review().
--   * reviews_select_all exposed reviewer_id and order_id publicly.
--     -> public reads go through reviews_public (no reviewer id, no order
--     id, first-name-and-initial display name, hidden rows excluded); the
--     base table is readable only by the review's own author (and admins).
--
-- Deliberately NOT here: seller replies (seller_response stays reserved and
-- unwritable), editing/deleting reviews, moderation UI (hidden_at is only
-- the reserved hook: nothing a client can reach sets it), notifications,
-- and any change to cash eligibility. profiles/businesses.rating_average
-- already feed evaluate_cash_eligibility() ('min_rating_average'); once
-- reviews can exist that becomes a live relationship — see DECISIONS.md.

-- 1. hidden_at: reserved for future moderation ------------------------------
alter table public.reviews add column hidden_at timestamptz;

-- 2. Comment validation -------------------------------------------------------
-- Optional; when present it is trimmed, non-empty and at most 1000
-- characters. Existing rows (none are expected: the old path could never
-- succeed for a real user) are normalized first so the constraint can be
-- added without rewriting meaning; an over-long existing comment would
-- fail this migration loudly rather than be silently truncated.
update public.reviews
set comment = regexp_replace(comment, '^\s+|\s+$', '', 'g')
where comment is not null and comment <> regexp_replace(comment, '^\s+|\s+$', '', 'g');

update public.reviews set comment = null where comment = '';

alter table public.reviews
  add constraint reviews_comment_valid check (
    comment is null
    or (
      char_length(comment) between 1 and 1000
      and comment = regexp_replace(comment, '^\s+|\s+$', '', 'g')
    )
  );

-- 3. Rating cache: SECURITY DEFINER + recompute from the source of truth -----
-- The seller's row is locked FIRST and the aggregate is computed in a
-- separate statement afterwards, so two reviews landing on the same seller
-- at once serialize on that row: the second sees the first's committed
-- review (READ COMMITTED takes a fresh snapshot per statement) instead of
-- overwriting it with a stale count.
create or replace function public.recompute_seller_rating(p_seller_type seller_type, p_profile_id uuid, p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_average numeric;
begin
  if p_seller_type = 'parent' then
    if p_profile_id is null then
      return;
    end if;
    perform 1 from public.profiles where id = p_profile_id for update;
    if not found then
      return;
    end if;
    select count(*)::integer, round(avg(rating)::numeric, 2) into v_count, v_average
    from public.reviews
    where seller_profile_id = p_profile_id and hidden_at is null;
    update public.profiles set rating_count = v_count, rating_average = v_average where id = p_profile_id;
  else
    if p_business_id is null then
      return;
    end if;
    perform 1 from public.businesses where id = p_business_id for update;
    if not found then
      return;
    end if;
    select count(*)::integer, round(avg(rating)::numeric, 2) into v_count, v_average
    from public.reviews
    where business_id = p_business_id and hidden_at is null;
    update public.businesses set rating_count = v_count, rating_average = v_average where id = p_business_id;
  end if;
end;
$$;

create or replace function public.apply_review_to_seller_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recompute_seller_rating(new.seller_type, new.seller_profile_id, new.business_id);
  elsif tg_op = 'UPDATE' then
    -- AFTER trigger: the table already holds the new state, so recomputing
    -- the old target covers a rating/hidden_at change; a changed target
    -- needs its new side recomputed too. Not reachable from any client
    -- today — this is what future moderation (hide/unhide) relies on.
    perform public.recompute_seller_rating(old.seller_type, old.seller_profile_id, old.business_id);
    if (new.seller_type, new.seller_profile_id, new.business_id) is distinct from (old.seller_type, old.seller_profile_id, old.business_id) then
      perform public.recompute_seller_rating(new.seller_type, new.seller_profile_id, new.business_id);
    end if;
  else
    perform public.recompute_seller_rating(old.seller_type, old.seller_profile_id, old.business_id);
  end if;
  return null;
end;
$$;

drop trigger if exists reviews_apply_to_seller_rating on public.reviews;
create trigger reviews_apply_to_seller_rating
  after insert or delete or update of rating, hidden_at, seller_type, seller_profile_id, business_id on public.reviews
  for each row execute function public.apply_review_to_seller_rating();

-- Internal only: nothing a client role should ever call directly.
revoke all on function public.recompute_seller_rating(seller_type, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_review_to_seller_rating() from public, anon, authenticated;

-- One-off: align the cache with any existing review rows (a no-op when there are none).
select public.recompute_seller_rating(seller_type, seller_profile_id, business_id)
from (select distinct seller_type, seller_profile_id, business_id from public.reviews) existing;

-- 4. create_review(): the ONLY write path -------------------------------------
-- The caller supplies the order, a rating and an optional comment — nothing
-- else. Reviewer = auth.uid(); the seller (parent or business) comes from
-- the order itself; seller_response, created_at and hidden_at take their
-- defaults and cannot be passed. UNIQUE (order_id) is the final guard
-- against duplicates, including two requests racing.
create or replace function public.create_review(p_order_id uuid, p_rating integer, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order record;
  v_comment text;
  v_review_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Invalid rating';
  end if;

  if p_comment is not null then
    v_comment := regexp_replace(p_comment, '^\s+|\s+$', '', 'g');
    if v_comment = '' or char_length(v_comment) > 1000 then
      raise exception 'Invalid comment';
    end if;
  end if;

  -- Not-found and not-yours are deliberately the same answer, so an order
  -- id can't be probed for existence.
  select id, buyer_id, status, completed_at, seller_type, seller_profile_id, business_id
  into v_order
  from public.orders
  where id = p_order_id
  for share;

  if not found or v_order.buyer_id <> v_user_id then
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'completed' or v_order.completed_at is null then
    raise exception 'Order is not completed';
  end if;

  if exists (select 1 from public.reviews where order_id = p_order_id) then
    raise exception 'Order has already been reviewed';
  end if;

  begin
    insert into public.reviews (order_id, reviewer_id, seller_type, seller_profile_id, business_id, rating, comment)
    values (v_order.id, v_user_id, v_order.seller_type, v_order.seller_profile_id, v_order.business_id, p_rating, v_comment)
    returning id into v_review_id;
  exception when unique_violation then
    -- A concurrent request reviewed this order between the check and the insert.
    raise exception 'Order has already been reviewed';
  end;

  return v_review_id;
end;
$$;

revoke execute on function public.create_review(uuid, integer, text) from public, anon;
grant execute on function public.create_review(uuid, integer, text) to authenticated;

-- 5. Privileges and policies on reviews ---------------------------------------
-- No client role can write the table any more; every client write goes
-- through create_review().
drop policy if exists reviews_insert_buyer_on_completed_order on public.reviews;
drop policy if exists reviews_select_all on public.reviews;

revoke all on public.reviews from public, anon, authenticated;

-- Direct reads of the base table: the review's own author (so the order page
-- can show "your review"), and admins. Column-limited so the reserved
-- moderation/reply columns (hidden_at, seller_response) are never readable
-- through the client API.
create policy reviews_select_own_or_admin on public.reviews
  for select using (reviewer_id = auth.uid() or public.is_admin());

grant select (id, order_id, reviewer_id, seller_type, seller_profile_id, business_id, rating, comment, created_at)
  on public.reviews to authenticated;

-- 6. Public representation ----------------------------------------------------
-- What anyone may read about reviews: no reviewer id, no order id, no
-- hidden rows, and the reviewer shown only as first name + last initial.
-- Seller identifiers are included because they are what a public page
-- filters by, and they are already public (profiles_public/businesses_public).
create view public.reviews_public
  with (security_invoker = false) as
  select
    r.id,
    r.seller_type,
    r.seller_profile_id,
    r.business_id,
    r.rating,
    r.comment,
    r.created_at,
    case
      when btrim(p.full_name) = '' then 'Bambini member'
      when btrim(p.full_name) ~ '\s' then
        split_part(btrim(p.full_name), ' ', 1) || ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.'
      else btrim(p.full_name)
    end as reviewer_name
  from public.reviews r
  join public.profiles p on p.id = r.reviewer_id
  where r.hidden_at is null;

revoke all on public.reviews_public from public, anon, authenticated;
grant select on public.reviews_public to anon, authenticated;

comment on table public.reviews is
  'One review per completed order, written only through create_review() (buyer of the order, seller derived from the order). Immutable in the MVP. hidden_at and seller_response are reserved for future moderation/replies and are not client-writable. Public reads go through reviews_public.';
