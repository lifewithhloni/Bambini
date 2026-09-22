-- Phase 7B: delivery reliability, state safety, and pre-payment cancellation.
--
-- Phase 7B's own inspection (see that phase's report) found three concrete
-- gaps in Phase 7A's delivery pipeline, none of them client-exploitable
-- today but all real before a fallible real provider is connected:
--
-- 1. sync_delivery_status() applied whatever status a provider reported
--    with no transition guard at all — a buggy/malicious provider
--    response could move a terminal delivery_orders row backwards.
-- 2. bookDeliveryForOrder() only checked delivery_providers.is_active at
--    order-creation time (inside create_order()), never again at booking
--    time — disabling a provider between order creation and payment
--    confirmation had no effect on whether that order still got booked.
-- 3. transaction_events (an append-only general audit log) has no
--    mechanism to detect a duplicate provider webhook delivery, and
--    delivery_orders.provider_tracking_ref has no uniqueness constraint,
--    so a future webhook-to-delivery-order lookup would not be safe.
--
-- This migration also adds the one cancellation path the phase's own
-- product-lock authorizes: a buyer cancelling their own delivery order
-- while it is still pending_payment and before any delivery_orders row
-- exists — the only state where no external courier has been booked and
-- no payment has completed, so no refund/courier-cancellation logic is
-- needed.
--
-- Explicitly NOT done here (per the phase's own non-goals): no automatic
-- retry of a stuck 'pending' delivery_orders row, no real webhook route,
-- no provider-specific idempotency implementation, no refunds, no
-- cancellation once a delivery has been booked.

-- 1. Delivery status state machine -------------------------------------
-- pending/booked/collected_by_courier/in_transit are non-terminal;
-- delivered/failed/cancelled are terminal. A terminal status never
-- transitions to anything else (a same-status call is a safe no-op, not
-- an error — see "repeated same-status updates" in the phase brief).
-- Among non-terminal statuses, only forward movement along the natural
-- courier lifecycle (pending -> booked -> collected_by_courier ->
-- in_transit) is allowed; any non-terminal status can move directly to
-- any terminal one (a real courier can fail or be cancelled at any
-- point, and can report "delivered" without every intermediate step
-- having been individually reported).
create function public.is_valid_delivery_status_transition(
  p_old delivery_order_status,
  p_new delivery_order_status
)
returns boolean
language sql
immutable
as $$
  select case
    when p_old = p_new then true
    when p_old in ('delivered', 'failed', 'cancelled') then false
    when p_new in ('delivered', 'failed', 'cancelled') then true
    else (
      array_position(array['pending', 'booked', 'collected_by_courier', 'in_transit']::delivery_order_status[], p_new)
      > array_position(array['pending', 'booked', 'collected_by_courier', 'in_transit']::delivery_order_status[], p_old)
    )
  end;
$$;

revoke all on function public.is_valid_delivery_status_transition(delivery_order_status, delivery_order_status) from public, anon, authenticated;
grant execute on function public.is_valid_delivery_status_transition(delivery_order_status, delivery_order_status) to service_role;

-- delivery_orders.last_synced_at: when trackingService.ts last actually
-- polled the provider for this delivery (regardless of whether the
-- status changed) — distinct from updated_at, which (via
-- sync_delivery_status()'s own pre-Phase-7B behavior) only changed when
-- the status itself changed. A polling cooldown needs "when did we last
-- ask", not "when did the answer last differ".
alter table public.delivery_orders add column last_synced_at timestamptz;

-- record_delivery_booking(): CREATE OR REPLACE, same signature — same
-- shape as Phase 7A's own booking outcome write, now routed through the
-- transition guard. In the normal flow this only ever fires once per
-- delivery_orders row (pending -> booked or pending -> failed,
-- immediately after reserve_delivery_order()'s fresh insert), so the
-- guard is defense in depth here, not a behavior change for the
-- documented flow — but it stops a future bug (or a second, wrongly
-- re-triggered booking attempt) from silently overwriting an
-- already-resolved row.
create or replace function public.record_delivery_booking(
  p_delivery_order_id uuid,
  p_provider_tracking_ref text,
  p_status delivery_order_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_current_status delivery_order_status;
begin
  select order_id, status into v_order_id, v_current_status
  from public.delivery_orders
  where id = p_delivery_order_id
  for update;

  if not found then
    raise exception 'Delivery order % not found', p_delivery_order_id;
  end if;

  if not public.is_valid_delivery_status_transition(v_current_status, p_status) then
    raise exception 'Invalid delivery status transition: % -> %', v_current_status, p_status;
  end if;

  if v_current_status = p_status then
    -- Idempotent no-op — still worth recording that we heard from the
    -- provider again, but never re-run the order-status side effect
    -- below (it's already guarded by its own status= check too, this
    -- just avoids a redundant transaction_events row).
    update public.delivery_orders set updated_at = now() where id = p_delivery_order_id;
    return;
  end if;

  update public.delivery_orders
  set provider_tracking_ref = p_provider_tracking_ref, status = p_status, updated_at = now()
  where id = p_delivery_order_id;

  if p_status = 'booked' then
    update public.orders set status = 'awaiting_delivery' where id = v_order_id and status = 'confirmed';
  end if;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, payload)
  values (
    v_order_id, 'delivery_order', p_delivery_order_id,
    case when p_status = 'booked' then 'delivery.booked' else 'delivery.booking_failed' end,
    'delivery_provider',
    jsonb_build_object('provider_tracking_ref', p_provider_tracking_ref, 'status', p_status)
  );
end;
$$;

revoke all on function public.record_delivery_booking(uuid, text, delivery_order_status) from public, anon, authenticated;
grant execute on function public.record_delivery_booking(uuid, text, delivery_order_status) to service_role;

-- sync_delivery_status(): CREATE OR REPLACE, same signature. Now:
-- 1. Always bumps last_synced_at, even when the reported status is
--    unchanged — this is what lets trackingService.ts's polling
--    cooldown (application code, not this migration) rate-limit calls
--    to provider.getStatus() using a real "when did we last check"
--    timestamp.
-- 2. Applies the same transition guard as record_delivery_booking()
--    above — a terminal delivery can never be moved by a later poll,
--    and a non-terminal delivery can only move forward.
create or replace function public.sync_delivery_status(p_order_id uuid, p_status delivery_order_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status delivery_order_status;
begin
  select status into v_current_status from public.delivery_orders where order_id = p_order_id for update;

  if not found then
    raise exception 'No delivery_orders row for order %', p_order_id;
  end if;

  if not public.is_valid_delivery_status_transition(v_current_status, p_status) then
    raise exception 'Invalid delivery status transition: % -> %', v_current_status, p_status;
  end if;

  update public.delivery_orders set status = p_status, last_synced_at = now(), updated_at = now() where order_id = p_order_id;

  if p_status in ('collected_by_courier', 'in_transit') then
    update public.orders set status = 'in_transit' where id = p_order_id and status in ('awaiting_delivery', 'in_transit');
  elsif p_status = 'delivered' then
    update public.orders set status = 'completed', completed_at = now() where id = p_order_id and status in ('awaiting_delivery', 'in_transit');
  end if;
end;
$$;

revoke all on function public.sync_delivery_status(uuid, delivery_order_status) from public, anon, authenticated;
grant execute on function public.sync_delivery_status(uuid, delivery_order_status) to service_role;

-- record_delivery_sync_attempt(): the provider-unreachable fallback path
-- in trackingService.ts still needs the cooldown to advance (otherwise a
-- down provider gets polled on every single page load with no rate
-- limit, which is exactly what the cooldown exists to prevent) — this
-- bumps last_synced_at alone, without touching status, for exactly that
-- case.
create function public.record_delivery_sync_attempt(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.delivery_orders set last_synced_at = now() where order_id = p_order_id;
$$;

revoke all on function public.record_delivery_sync_attempt(uuid) from public, anon, authenticated;
grant execute on function public.record_delivery_sync_attempt(uuid) to service_role;

-- 2. Provider tracking reference uniqueness ------------------------------
-- Partial (nullable column) — makes a future webhook's "look up the
-- Bambini delivery order for this provider tracking reference" lookup
-- safe by construction. No existing data can violate this: Phase 7A only
-- just shipped, provider_tracking_ref is set exactly once per row (by
-- record_delivery_booking(), immediately after a freshly-generated ref
-- from the provider), and nothing before this migration ever wrote it
-- any other way.
create unique index delivery_orders_provider_tracking_ref_idx
  on public.delivery_orders (provider_tracking_ref)
  where provider_tracking_ref is not null;

-- 3. Provider event idempotency foundation -------------------------------
-- Deliberately NOT layered onto transaction_events (a general,
-- append-only audit log shared by every entity type in this schema, with
-- no per-row uniqueness concept) — a dedicated table whose whole job is
-- "has this specific provider webhook delivery already been processed".
-- No public webhook route reads or writes this yet (out of this phase's
-- scope); this is the database foundation a future webhook route would
-- insert into, via the same insert-with-conflict-check idempotency
-- pattern reserve_delivery_order() already established.
create table public.delivery_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.delivery_providers (id) on delete restrict,
  -- Scoped uniqueness per provider, not globally — two different
  -- couriers' own event-id namespaces are theirs alone and could
  -- legitimately collide as raw strings.
  provider_event_id text not null,
  event_type text not null,
  delivery_order_id uuid references public.delivery_orders (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  -- Null = not yet processed. A separate enum/status column was
  -- considered and skipped as unnecessary for the same reason
  -- payments.status doesn't need a "cancelled" value it'll never use —
  -- "processed or not" is the only distinction anything here currently
  -- needs; a real processing pipeline (retries, failures) is exactly the
  -- "real webhook route" this phase deliberately doesn't build yet.
  processed_at timestamptz,
  unique (provider_id, provider_event_id)
);

create index delivery_provider_events_delivery_order_id_idx on public.delivery_provider_events (delivery_order_id);

alter table public.delivery_provider_events enable row level security;
-- No policies for anon/authenticated at all — this table has no
-- legitimate direct client access in any direction, the same
-- "service-role only, by omission" shape as every other purely
-- internal table in this schema. service_role bypasses RLS entirely, so
-- this is enabling the row-security switch for defense in depth (matches
-- every other table in this schema), not the actual access boundary —
-- the REVOKE below on the write function is.

-- record_provider_event(): the on-conflict-do-nothing idempotency check
-- itself, same shape as reserve_delivery_order(). Returns the new
-- event's id, or NULL if (provider_id, provider_event_id) was already
-- recorded — the caller (a future webhook route) treats NULL as "safe
-- to ignore, already processed", never as a failure.
create function public.record_provider_event(
  p_provider_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_delivery_order_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.delivery_provider_events (provider_id, provider_event_id, event_type, delivery_order_id, payload)
  values (p_provider_id, p_provider_event_id, p_event_type, p_delivery_order_id, p_payload)
  on conflict (provider_id, provider_event_id) do nothing
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_provider_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_event(uuid, text, text, uuid, jsonb) to service_role;

-- 4. Pre-payment delivery cancellation ------------------------------------
-- The one cancellation path this phase's product lock authorizes: buyer,
-- own order, fulfilment_type = 'delivery', status still
-- 'pending_payment', and no delivery_orders row exists yet (i.e. no
-- courier has ever been contacted). No payment has completed at this
-- point (payments.status is still 'pending' — 'paid' only happens via
-- process_payfast_itn(), which requires status = 'pending_payment' to
-- even attempt, so cancelling first makes a later, in-flight payment
-- confirmation impossible: process_payfast_itn()'s own
-- `where o.id = p_order_id and o.status = 'pending_payment'` guard would
-- simply match zero rows), so there is deliberately no refund logic
-- here — there is nothing to refund.
--
-- Listing restoration mirrors decline_cash_order()'s own
-- verified-seller-then-republish-else-draft pattern, but not by copying
-- it blindly: enforce_seller_verification_on_publish() (Phase 5) fires
-- on ANY update that moves a product's status to 'published', including
-- this cancellation's own restore step, and raises an exception if the
-- seller (individual, or business for a business listing) is not
-- currently verified. A naive unconditional
-- `update products set status = 'published' ...` would therefore throw
-- and abort the whole cancellation the moment a seller's verification
-- has lapsed since the listing was originally published — the exact
-- failure mode decline_cash_order() was already built to avoid. The fix
-- is the same because the cause is the same trigger, not because
-- cash-specific business rules apply here.
create function public.cancel_pending_delivery_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_order record;
  v_product_id uuid;
  v_seller_verified boolean;
  v_business_verified boolean;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  select o.id, o.status, o.fulfilment_type, o.seller_type, o.seller_profile_id, o.business_id
  into v_order
  from public.orders o
  where o.id = p_order_id and o.buyer_id = v_buyer_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.fulfilment_type <> 'delivery' then
    raise exception 'Only delivery orders can be cancelled this way';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'Order cannot be cancelled at this stage';
  end if;

  if exists (select 1 from public.delivery_orders where order_id = p_order_id) then
    raise exception 'Order cannot be cancelled at this stage';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;

  -- Nothing was ever collected for this order (payment never completed)
  -- — 'settled' closes out the speculative 'collected_via_payment'
  -- commission row the same way decline_cash_order() closes out a
  -- declined cash order's, so nothing downstream mistakes this order for
  -- one that still owes or has paid a commission.
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
  values (p_order_id, 'order', p_order_id, 'delivery_order.cancelled_before_payment', 'buyer', v_buyer_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.cancel_pending_delivery_order(uuid) from public, anon;
grant execute on function public.cancel_pending_delivery_order(uuid) to authenticated;

-- 5. Admin visibility for stuck-pending deliveries -------------------------
-- Read-only, admin-gated INSIDE the function (same "granted broadly to
-- authenticated, is_admin() checked internally" pattern
-- review_identity_verification()/review_business_verification() already
-- use — there is no separate Postgres role for "admin" in this schema).
-- Deliberately excludes pickup/dropoff location ids and raw_response —
-- an admin investigating a stuck booking needs to know WHICH delivery is
-- stuck and WHO to ask the provider about (the tracking ref, if any),
-- never a buyer/seller's coordinates or the full raw provider payload.
-- No mutation of any kind happens here — see this phase's own product
-- lock: no automatic retry, no automatic re-booking.
create function public.list_stuck_pending_deliveries(p_older_than_minutes integer default 10)
returns table (
  delivery_order_id uuid,
  order_id uuid,
  order_reference text,
  provider_name text,
  quote_id uuid,
  service_level delivery_service_level,
  price_cents bigint,
  status delivery_order_status,
  provider_tracking_ref text,
  created_at timestamptz,
  updated_at timestamptz,
  age_minutes numeric
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
    do_.id,
    do_.order_id,
    o.order_reference,
    dp.name,
    dq.id,
    dq.service_level,
    dq.price_cents,
    do_.status,
    do_.provider_tracking_ref,
    do_.created_at,
    do_.updated_at,
    extract(epoch from (now() - do_.created_at)) / 60.0
  from public.delivery_orders do_
  join public.orders o on o.id = do_.order_id
  left join public.delivery_providers dp on dp.id = do_.provider_id
  left join public.delivery_quotes dq on dq.id = do_.quote_id
  where do_.status = 'pending'
    and do_.created_at < now() - (p_older_than_minutes || ' minutes')::interval
  order by do_.created_at asc;
end;
$$;

revoke execute on function public.list_stuck_pending_deliveries(integer) from public, anon;
grant execute on function public.list_stuck_pending_deliveries(integer) to authenticated;
