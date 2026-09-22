-- Phase 8C: business seller self-service payout requests.
--
-- Extends the Phase 8B (extension) seller-requested payout model to
-- business sellers, using the existing business ownership/membership
-- schema as the sole source of authorization truth — nothing new was
-- invented.
--
-- BUSINESS AUTHORIZATION MODEL (read this before touching either
-- function below):
--
-- The existing schema already encodes two distinct authority tiers for
-- a business, both load-bearing today:
--
--   1. "any member" — businesses.owner_profile_id = auth.uid() OR a row
--      in business_members for that business (regardless of its `role`
--      text, which defaults to 'staff' and is otherwise unused anywhere
--      in this codebase — no function or policy reads it to distinguish
--      anything). is_business_member() is this tier. It already governs
--      every OPERATIONAL business action: creating/editing listings
--      (products RLS), viewing the business's own orders/payouts/
--      delivery orders, submitting a business_verifications row.
--   2. "owner only" — businesses.owner_profile_id = auth.uid(),
--      independent of any business_members row. This is the schema's
--      OWN existing, stricter tier: businesses_update_owner_or_admin
--      (only the owner can change business settings) and
--      business_members_insert_owner / business_members_delete_owner_or_admin
--      (only the owner can add or remove staff) both already gate on
--      exactly this, never on membership alone.
--
-- A payout REQUEST moves money out of the business's account — it is
-- categorically closer to "change business settings" / "manage staff"
-- than to "list a product" or "view an order". Per this phase's own
-- instruction to use existing roles rather than invent a new permission
-- system, and since business_members.role carries no real, already-used
-- semantics to repurpose, this migration reuses the schema's EXISTING
-- stricter tier: only the business owner (businesses.owner_profile_id =
-- auth.uid()) may call request_business_payout(). Reading the
-- available balance and payout history remains "any member" (matching
-- payouts_select_recipient_or_admin's own existing is_business_member()
-- scope for reads) — a staff member can see the business's payouts,
-- they just cannot trigger a new one. This is not a gap requiring a
-- schema change: owner_profile_id is already a real, enforced,
-- unambiguous authorization signal for precisely this class of action.
--
-- Both functions take an explicit p_business_id — necessary because,
-- unlike a parent seller (always exactly "me"), a single person can own
-- or belong to more than one business, so "which business" cannot be
-- inferred from auth.uid() alone. The id is never trusted on its own:
-- every code path re-verifies the caller's actual authorization for
-- that specific business before reading or moving anything, the same
-- "an id is a lookup key, never a financial authority by itself"
-- pattern this whole schema already uses everywhere else (compare
-- create_seller_payout()'s own re-validation of every order id it's
-- given).
--
-- The eligibility formula, locking strategy, and recovery interaction
-- are otherwise identical to request_seller_payout()
-- (20261006090000_seller_requested_payouts.sql) — see that migration's
-- own header for the full reasoning on why the FOR UPDATE lock target
-- must be a subquery-free predicate. A recovered business payout's
-- superseded claim becomes available again automatically, with no
-- special-casing, for exactly the same reason it does for parent
-- sellers: both eligibility formulas filter on
-- payout_items.superseded_at is null, and recovery is the only thing
-- that ever sets it.

-- 1. Server-authoritative business available balance ----------------------
create function public.get_business_available_balance(p_business_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_business_member(p_business_id) then
    raise exception 'You are not authorized to view this business''s balance';
  end if;

  return coalesce((
    select sum(o.subtotal_cents - o.commission_amount_cents)
    from public.orders o
    where o.seller_type = 'business'
      and o.business_id = p_business_id
      and o.payment_method = 'online'
      and o.status = 'completed'
      and not exists (
        select 1 from public.payout_items pi
        where pi.order_id = o.id and pi.superseded_at is null
      )
  ), 0)::bigint;
end;
$$;

revoke execute on function public.get_business_available_balance(uuid) from public, anon;
grant execute on function public.get_business_available_balance(uuid) to authenticated;

-- 2. request_business_payout(): business-owner-only, atomic --------------
-- Takes only p_business_id — never an amount, order ids, a payout id,
-- or any other client-supplied financial value. Every eligible order
-- and the total are derived entirely server-side, exactly like
-- request_seller_payout().
create function public.request_business_payout(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payout_id uuid;
  v_total_cents bigint;
  v_locked_order_ids uuid[];
  v_eligible_order_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.businesses where id = p_business_id and owner_profile_id = v_user_id
  ) then
    raise exception 'Only the business owner can request a payout';
  end if;

  -- Lock every one of this business's completed, online orders
  -- unconditionally (not pre-filtered by claim status) — see this
  -- migration's own header and request_seller_payout()'s migration
  -- comment for why a subquery-free predicate is what makes `for
  -- update` a safe serialization point. Two concurrent calls for the
  -- same business (e.g. the owner double-clicking, or two open tabs)
  -- block here on the exact same rows until the first commits.
  with locked_orders as (
    select o.id
    from public.orders o
    where o.seller_type = 'business'
      and o.business_id = p_business_id
      and o.payment_method = 'online'
      and o.status = 'completed'
    for update
  )
  select array_agg(id) into v_locked_order_ids from locked_orders;

  if v_locked_order_ids is null then
    raise exception 'No eligible earnings are available to withdraw';
  end if;

  select array_agg(o.id), coalesce(sum(o.subtotal_cents - o.commission_amount_cents), 0)
  into v_eligible_order_ids, v_total_cents
  from public.orders o
  where o.id = any(v_locked_order_ids)
    and not exists (
      select 1 from public.payout_items pi
      where pi.order_id = o.id and pi.superseded_at is null
    );

  if v_eligible_order_ids is null then
    raise exception 'No eligible earnings are available to withdraw';
  end if;

  -- Financial ownership belongs to the BUSINESS (recipient_business_id),
  -- never to the requesting member's own profile — this is what keeps
  -- this a business payout, not an accidental personal one.
  insert into public.payouts (recipient_type, recipient_business_id, amount_cents, status, period_start, period_end)
  values ('business', p_business_id, v_total_cents, 'pending', now(), now())
  returning id into v_payout_id;

  insert into public.payout_items (payout_id, order_id, amount_cents)
  select v_payout_id, o.id, o.subtotal_cents - o.commission_amount_cents
  from public.orders o where o.id = any(v_eligible_order_ids);

  -- transaction_events, not admin_actions (a business-owner-initiated
  -- financial event, not a platform-staff action) — actor_id identifies
  -- the specific requesting member, payload also records which business
  -- the payout belongs to, so the audit trail distinguishes "who
  -- clicked the button" from "whose money it is".
  insert into public.transaction_events (entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (
    'payout', v_payout_id, 'payout.requested', 'seller', v_user_id,
    jsonb_build_object('business_id', p_business_id, 'order_ids', v_eligible_order_ids, 'total_cents', v_total_cents)
  );

  return v_payout_id;
end;
$$;

revoke execute on function public.request_business_payout(uuid) from public, anon;
grant execute on function public.request_business_payout(uuid) to authenticated;
