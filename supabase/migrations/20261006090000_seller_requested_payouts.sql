-- Phase 8B (extension): seller-requested, order-independent payouts.
--
-- Bambini does not run weekly automatic payout batches. Once a seller's
-- earnings become eligible, THEY can request their own available
-- balance — the client never supplies an amount, an order id, a payout
-- id, or a seller id. Both the balance shown on /sell/payouts and the
-- payout actually created by request_seller_payout() are derived,
-- server-side, from the exact same eligibility formula this schema
-- already established for admin eligibility
-- (adminPayoutEligibility.ts / create_seller_payout(): completed,
-- online, not already actively claimed).
--
-- Scope: parent sellers only (seller_type = 'parent',
-- seller_profile_id = auth.uid()). create_seller_payout() already
-- requires every order in one payout to belong to exactly one seller
-- entity, and a business can have several members — resolving "which
-- business" a given staff member means to withdraw for, with no id
-- supplied at all, is genuinely ambiguous and outside this phase's own
-- brief (every example in it is a single individual's personal
-- earnings). Business payouts continue through the existing
-- admin-initiated create_seller_payout() flow, completely unchanged.
--
-- Concurrency: two concurrent request_seller_payout() calls for the
-- SAME seller (e.g. two browser tabs) must never double-claim the same
-- earnings. The lock target is deliberately every one of the seller's
-- completed+online orders, not pre-filtered by claim status — a
-- subquery-free predicate is what makes `for update` a safe,
-- unambiguous serialization point (a WHERE clause containing a
-- correlated NOT EXISTS against a different table is not something
-- Postgres's EvalPlanQual is guaranteed to re-check correctly across a
-- lock wait — the same reasoning every other payout-mutating function
-- in this schema already follows: lock first with a plain predicate,
-- THEN issue a fresh, separate eligibility check once the lock is
-- held). Once every candidate order is locked, the second, completely
-- fresh read of payout_items is guaranteed accurate: any concurrent
-- call that already claimed some of them had to lock those exact same
-- order rows first, so by the time we hold the lock it has either
-- committed (its rows are now visible to us) or is still queued behind
-- us. `for update` cannot be combined with an aggregate directly, so
-- the lock itself happens inside a CTE (a plain, non-aggregated row
-- select) and array_agg() is only ever applied to that CTE's
-- already-locked result. The partial unique index from the previous
-- migration (payout_items_order_id_active_unique) remains the final,
-- irreducible backstop even if any of this reasoning ever had a bug.

-- 1. Server-authoritative available balance -------------------------------
-- Never a stored/mutable column (nothing to drift from the ledger) —
-- always derived fresh from orders + payout_items at read time, exactly
-- the same formula request_seller_payout() itself locks and re-checks
-- before creating a payout.
create function public.get_seller_available_balance()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(o.subtotal_cents - o.commission_amount_cents), 0)::bigint
  from public.orders o
  where o.seller_type = 'parent'
    and o.seller_profile_id = auth.uid()
    and o.payment_method = 'online'
    and o.status = 'completed'
    and not exists (
      select 1 from public.payout_items pi
      where pi.order_id = o.id and pi.superseded_at is null
    );
$$;

revoke execute on function public.get_seller_available_balance() from public, anon;
grant execute on function public.get_seller_available_balance() to authenticated;

-- 2. request_seller_payout(): seller-only, atomic, order-independent -----
-- Takes NO arguments at all — not an amount, not order ids, not a
-- seller id. The authenticated caller (auth.uid()) IS the seller; every
-- eligible order and the total are derived entirely server-side.
create function public.request_seller_payout()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_payout_id uuid;
  v_total_cents bigint;
  v_locked_order_ids uuid[];
  v_eligible_order_ids uuid[];
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  -- Lock every one of this seller's completed, online orders
  -- unconditionally (not pre-filtered by claim status) — see this
  -- migration's own header for why a subquery-free predicate is what
  -- makes this a safe serialization point. A second, concurrent call
  -- from the same seller blocks here until this transaction commits or
  -- rolls back.
  with locked_orders as (
    select o.id
    from public.orders o
    where o.seller_type = 'parent'
      and o.seller_profile_id = v_seller_id
      and o.payment_method = 'online'
      and o.status = 'completed'
    for update
  )
  select array_agg(id) into v_locked_order_ids from locked_orders;

  if v_locked_order_ids is null then
    raise exception 'No eligible earnings are available to withdraw';
  end if;

  -- Now that every candidate order is locked, this is a fresh, accurate
  -- read — any concurrent call that already claimed some of these same
  -- orders had to lock them first too, so it has either committed (its
  -- payout_items rows are now visible here) or is still blocked behind us.
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

  insert into public.payouts (recipient_type, recipient_profile_id, amount_cents, status, period_start, period_end)
  values ('parent', v_seller_id, v_total_cents, 'pending', now(), now())
  returning id into v_payout_id;

  insert into public.payout_items (payout_id, order_id, amount_cents)
  select v_payout_id, o.id, o.subtotal_cents - o.commission_amount_cents
  from public.orders o where o.id = any(v_eligible_order_ids);

  -- transaction_events, not admin_actions — this is a seller-initiated
  -- financial event, not a platform-staff action (admin_actions' own
  -- header comment scopes it explicitly to staff actions). order_id is
  -- left null (a payout request spans multiple orders, and
  -- transaction_events.order_id is a single-order denormalization) —
  -- every claimed order id is still recorded in payload instead.
  insert into public.transaction_events (entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (
    'payout', v_payout_id, 'payout.requested', 'seller', v_seller_id,
    jsonb_build_object('order_ids', v_eligible_order_ids, 'total_cents', v_total_cents)
  );

  return v_payout_id;
end;
$$;

revoke execute on function public.request_seller_payout() from public, anon;
grant execute on function public.request_seller_payout() to authenticated;
