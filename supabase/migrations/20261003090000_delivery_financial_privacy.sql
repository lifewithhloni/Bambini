-- Phase 7D: delivery financial visibility & security hardening.
--
-- Phase 7C's own report flagged this precisely: orders.provider_delivery_cost_cents/
-- delivery_markup_percentage_bps/delivery_markup_amount_cents (and their
-- delivery_quotes equivalents) were buyer/seller-readable at the RLS row
-- level, hidden only by application-code convention (no query ever
-- selects them back to a browser) — a deliberate choice at the time,
-- justified by precedent (commission_rate_bps/commission_amount_cents
-- already worked the same way on this exact table). This phase's own
-- brief is explicit that this precedent should NOT be assumed to extend
-- to delivery economics, so this migration closes the gap directly at
-- the database layer rather than continuing to rely on every future
-- query author remembering not to select these columns.
--
-- Mechanism: column-level REVOKE/GRANT, the exact pattern already
-- established in this schema for collection_code on
-- collection_confirmations (20260927090000_cash_collection_transactions.sql
-- section 4) — RLS decides which ROWS are visible; this decides which
-- COLUMNS are, for a role that already passes RLS. Scoped to
-- `authenticated` specifically (mirroring collection_code's own scoping)
-- — service_role is untouched, so every SECURITY DEFINER function
-- (create_order(), reserve_delivery_order(), the new admin function
-- below, ...) keeps working exactly as before: a SECURITY DEFINER
-- function's internal reads execute as the function's OWNER, never as
-- the calling role, so a column grant revoked from `authenticated` has
-- no effect on what any existing function can read internally — the
-- same "SECURITY DEFINER bypasses grants exactly like it bypasses RLS"
-- fact this schema has already relied on repeatedly.
--
-- This DOES mean an admin's own ordinary signed-in session can no
-- longer read these columns via a plain `.select()` either (column
-- grants apply per role, not per RLS-policy-outcome — there is no
-- separate Postgres role for "admin" in this schema). That's why the
-- new admin financial view below is itself a SECURITY DEFINER function
-- (is_admin() checked internally, exactly like
-- list_stuck_pending_deliveries()), not a plain authenticated query —
-- the column revoke doesn't block it for the same reason it doesn't
-- block create_order().

-- 1. orders: hide the delivery cost/markup breakdown from every direct
--    client read, buyer or seller -------------------------------------
-- Every other column keeps exactly the access it had before — this is
-- not a general lockdown of the orders table, just these three fields.
-- commission_rate_bps/commission_amount_cents are deliberately left
-- alone: Part 4 of this phase's brief requires the seller to keep
-- seeing commission, and changing that isn't a security requirement of
-- this phase.
revoke select on public.orders from authenticated;
grant select (
  id, order_reference, buyer_id, seller_type, seller_profile_id, business_id,
  fulfilment_type, payment_method, status,
  subtotal_cents, delivery_fee_cents, total_cents,
  commission_rate_bps, commission_amount_cents,
  currency, delivery_location_id, created_at, updated_at, completed_at
) on public.orders to authenticated;

-- 2. delivery_quotes: same treatment, plus raw_response ------------------
-- raw_response is the provider's own raw returned payload — for the
-- mock provider today this happens to just be the same DeliveryQuote
-- object (including its own unmarked-up price), but a real adapter's
-- raw_response could contain provider-specific cost/pricing detail no
-- differently sensitive than provider_cost_cents itself, so it gets the
-- same treatment here rather than waiting for a real provider to prove
-- the point.
revoke select on public.delivery_quotes from authenticated;
grant select (
  id, order_id, pickup_location_id, dropoff_location_id, provider_id,
  service_level, price_cents, currency, eta_min_minutes, eta_max_minutes,
  provider_quote_ref, expires_at, created_at, requested_by, product_id
) on public.delivery_quotes to authenticated;

-- 3. Admin delivery financial view ---------------------------------------
-- Granted broadly to `authenticated`, is_admin() checked internally —
-- the same pattern list_stuck_pending_deliveries() already established.
-- Read-only; no mutation of any kind. Covers both collection and
-- delivery orders (collection rows simply show 0/0/null for every
-- delivery-specific field, never a rounding artifact — see
-- calculateDeliveryMarkup()'s own R0-in-R0-out guarantee, which is what
-- create_order() actually persists for a collection order). Optional
-- filters are all `is null or ...`, so omitting a filter is the same as
-- "match everything" — a clean table, not an analytics engine.
create function public.list_delivery_financial_transactions(
  p_fulfilment_type fulfilment_type default null,
  p_delivery_status delivery_order_status default null,
  p_payment_status payment_status default null,
  p_provider_slug text default null,
  p_created_after timestamptz default null,
  p_created_before timestamptz default null,
  p_limit integer default 200
)
returns table (
  order_id uuid,
  order_reference text,
  created_at timestamptz,
  fulfilment_type fulfilment_type,
  provider_slug text,
  provider_delivery_cost_cents bigint,
  buyer_delivery_fee_cents bigint,
  delivery_markup_percentage_bps integer,
  delivery_markup_amount_cents bigint,
  -- Bambini's DELIVERY margin — buyer_delivery_fee - provider_cost.
  -- Deliberately a distinct concept from commission_amount_cents (the
  -- MARKETPLACE commission on the product sale) — never summed or
  -- conflated with it anywhere in this function.
  delivery_margin_cents bigint,
  delivery_status delivery_order_status,
  payment_status payment_status
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  return query
  select
    o.id,
    o.order_reference,
    o.created_at,
    o.fulfilment_type,
    dp.slug,
    o.provider_delivery_cost_cents,
    o.delivery_fee_cents,
    o.delivery_markup_percentage_bps,
    o.delivery_markup_amount_cents,
    o.delivery_fee_cents - o.provider_delivery_cost_cents,
    do_.status,
    pay.status
  from public.orders o
  left join public.delivery_quotes dq on dq.order_id = o.id
  left join public.delivery_providers dp on dp.id = dq.provider_id
  left join public.delivery_orders do_ on do_.order_id = o.id
  left join public.payments pay on pay.order_id = o.id
  where (p_fulfilment_type is null or o.fulfilment_type = p_fulfilment_type)
    and (p_delivery_status is null or do_.status = p_delivery_status)
    and (p_payment_status is null or pay.status = p_payment_status)
    and (p_provider_slug is null or dp.slug = p_provider_slug)
    and (p_created_after is null or o.created_at >= p_created_after)
    and (p_created_before is null or o.created_at <= p_created_before)
  order by o.created_at desc
  limit p_limit;
end;
$$;

revoke execute on function public.list_delivery_financial_transactions(
  fulfilment_type, delivery_order_status, payment_status, text, timestamptz, timestamptz, integer
) from public, anon;
grant execute on function public.list_delivery_financial_transactions(
  fulfilment_type, delivery_order_status, payment_status, text, timestamptz, timestamptz, integer
) to authenticated;
