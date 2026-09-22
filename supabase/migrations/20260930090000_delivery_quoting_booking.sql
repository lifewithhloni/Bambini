-- Phase 7A: delivery quoting + checkout + booking foundation.
--
-- Phase 7's own inspection (see the Phase 7 report) found the delivery
-- subsystem entirely schema-only: delivery_quotes/delivery_orders/
-- delivery_providers existed with correct SELECT-only RLS but nothing
-- ever wrote to them, create_order() hardcoded delivery_fee_cents to 0,
-- and the DeliveryProvider abstraction (with a working MockDeliveryProvider)
-- was never called from anywhere. This migration wires the database side
-- of that pipeline; the provider calls themselves happen in application
-- code (src/server/delivery/), since PL/pgSQL cannot make an HTTP/JS call
-- to a courier API — see that inspection report's §21.3 decision.
--
-- 1. delivery_quotes gets two new columns closing two real replay/
--    ownership gaps the inspection's own instructions (§5, §9) called
--    out ahead of time:
--
--    - requested_by: a quote is fetched by a signed-in buyer BEFORE an
--      order exists (order_id is null at that point) — without a
--      server-set owner column, "order_id is null" as a SELECT
--      condition would make every buyer's pending quote readable by
--      every other authenticated user. requested_by is only ever set
--      by the server-side quote service (never client input), so RLS
--      can key off it exactly like every other owner column in this
--      schema.
--    - product_id: without it, a quote for Product A and a quote for
--      Product B from the SAME seller would have identical
--      pickup/dropoff location ids (same seller location, same buyer
--      location) and therefore be indistinguishable by location alone
--      — a quote fetched against one listing could be silently reused
--      to buy a different one from the same seller at the first
--      listing's price. Storing product_id and checking it in
--      create_order() closes that specific replay path directly,
--      rather than relying on location coincidence.
--
--    Both nullable at the schema level (matching order_id's own
--    nullable-with-on-delete-set-null shape) — always populated by the
--    one sanctioned write path (the quote service, using the
--    service-role client), never enforced NOT NULL so a referenced
--    user/product's deletion doesn't retroactively invalidate audit
--    history.
alter table public.delivery_quotes
  add column requested_by uuid references auth.users (id) on delete set null,
  add column product_id uuid references public.products (id) on delete set null;

create index delivery_quotes_requested_by_idx on public.delivery_quotes (requested_by);

-- Replaces the Phase 0 policy's blanket "order_id is null" (which made
-- every not-yet-attached quote readable by any authenticated user) with
-- ownership via requested_by. Once a quote is attached to an order
-- (order_id set), the original buyer-of-that-order clause still applies
-- too — both can be true for the same row, which is fine.
drop policy delivery_quotes_select_own_or_admin on public.delivery_quotes;

create policy delivery_quotes_select_own_or_admin on public.delivery_quotes
  for select using (
    requested_by = auth.uid()
    or exists (
      select 1 from public.orders o
      where o.id = order_id and (o.buyer_id = auth.uid() or public.is_admin())
    )
    or public.is_admin()
  );

-- 2. create_order(): extended with a trailing, defaulted
--    p_delivery_quote_id.
--
--    Never trusts the client for delivery_fee_cents/total_cents: the fee
--    always comes from the server-persisted delivery_quotes row this
--    function itself revalidates line by line (ownership, product match,
--    pickup/dropoff match, expiry, provider still active) under the same
--    row lock (`for update`) that already protects the products table
--    against overselling — a second concurrent create_order() call
--    targeting the same quote blocks on that lock, then re-evaluates
--    "is this quote still unclaimed" against the first call's
--    now-committed order_id and fails cleanly, the same race-safety
--    pattern this function already relies on for products.status.
--
--    DROP+CREATE, not CREATE OR REPLACE — adding a new parameter changes
--    the function's argument-type signature (its actual identity to
--    Postgres), not just its body, so CREATE OR REPLACE would leave the
--    old 3-argument create_order() in place as a second, now-ambiguous
--    overload rather than replacing it (confirmed the hard way: doing
--    this as CREATE OR REPLACE made every existing 3-argument call site
--    fail with "function ... is not unique"). Same convention Phase 4C
--    already established for this exact function
--    (20260927090000_cash_collection_transactions.sql's own
--    `drop function public.create_order(uuid, fulfilment_type);`) when
--    it added p_payment_method.
drop function public.create_order(uuid, fulfilment_type, payment_method);

create function public.create_order(
  p_product_id uuid,
  p_fulfilment_type fulfilment_type,
  p_payment_method payment_method default 'online',
  p_delivery_quote_id uuid default null
)
returns table (order_id uuid, order_reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_seller_type seller_type;
  v_seller_profile_id uuid;
  v_business_id uuid;
  v_title text;
  v_price_cents bigint;
  v_currency text;
  v_collection_available boolean;
  v_delivery_available boolean;
  v_pickup_location_id uuid;
  v_rate_bps integer;
  v_commission_cents bigint;
  v_provider_id uuid;
  v_delivery_location_id uuid;
  v_delivery_fee_cents bigint := 0;
  v_total_cents bigint;
  v_order_id uuid;
  v_order_reference text;
  v_settlement_status commission_settlement_status;
  v_cash_enabled boolean;
  v_eligible boolean;
  v_failed_criteria text[];
  v_collection_code text;
  v_rand_bytes bytea;
  v_attempts integer := 0;
  v_quote record;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_transact() then
    raise exception 'Account verification required before purchasing.';
  end if;

  if p_payment_method = 'cash' and p_fulfilment_type = 'delivery' then
    raise exception 'Cash on collection is not available for delivery orders';
  end if;

  if p_fulfilment_type = 'collection' and p_delivery_quote_id is not null then
    raise exception 'A delivery quote cannot be used with collection';
  end if;

  update public.products
  set status = 'sold'
  where id = p_product_id and status = 'published'
  returning seller_type, seller_profile_id, business_id, title, price_cents, currency,
    collection_available, delivery_available, pickup_location_id
  into v_seller_type, v_seller_profile_id, v_business_id, v_title, v_price_cents, v_currency,
    v_collection_available, v_delivery_available, v_pickup_location_id;

  if not found then
    raise exception 'Product is not available for purchase';
  end if;

  if v_seller_type = 'parent' and v_seller_profile_id = v_buyer_id then
    raise exception 'Cannot buy your own listing';
  end if;
  if v_seller_type = 'business' and public.is_business_member(v_business_id) then
    raise exception 'Cannot buy your own listing';
  end if;

  if p_fulfilment_type = 'collection' and not v_collection_available then
    raise exception 'Collection is not available for this listing';
  end if;
  if p_fulfilment_type = 'delivery' and not v_delivery_available then
    raise exception 'Delivery is not available for this listing';
  end if;

  if p_fulfilment_type = 'delivery' then
    select location_id into v_delivery_location_id from public.profiles where id = v_buyer_id;
    if v_delivery_location_id is null then
      raise exception 'Set your delivery location before checking out';
    end if;

    if p_delivery_quote_id is null then
      raise exception 'Select a delivery option before checking out';
    end if;

    -- Row-locked so a concurrent create_order() call racing on the same
    -- quote serializes here, exactly mirroring the products.status
    -- overselling guard above.
    select * into v_quote from public.delivery_quotes where id = p_delivery_quote_id for update;

    if not found then
      raise exception 'Delivery quote not found';
    end if;
    if v_quote.requested_by is distinct from v_buyer_id then
      raise exception 'Delivery quote not found';
    end if;
    if v_quote.order_id is not null then
      raise exception 'Delivery quote has already been used';
    end if;
    if v_quote.expires_at <= now() then
      raise exception 'Delivery quote expired. Please refresh delivery options.';
    end if;
    if v_quote.product_id is distinct from p_product_id then
      raise exception 'Delivery quote does not match this listing. Please refresh delivery options.';
    end if;
    if v_quote.pickup_location_id is distinct from v_pickup_location_id then
      raise exception 'Delivery quote is no longer valid for this listing. Please refresh delivery options.';
    end if;
    if v_quote.dropoff_location_id is distinct from v_delivery_location_id then
      raise exception 'Delivery quote is no longer valid for your delivery location. Please refresh delivery options.';
    end if;
    if not exists (select 1 from public.delivery_providers where id = v_quote.provider_id and is_active) then
      raise exception 'Delivery provider is currently unavailable. Please refresh delivery options.';
    end if;

    v_delivery_fee_cents := v_quote.price_cents;
  end if;

  select rate_bps into v_rate_bps
  from public.commission_rates
  where seller_type = v_seller_type and effective_from <= now()
  order by effective_from desc
  limit 1;

  if v_rate_bps is null then
    raise exception 'No commission rate configured for this seller type';
  end if;

  v_commission_cents := round((v_price_cents * v_rate_bps) / 10000.0);
  v_total_cents := v_price_cents + v_delivery_fee_cents;

  if p_payment_method = 'online' then
    select id into v_provider_id from public.payment_providers where is_active limit 1;
    if v_provider_id is null then
      raise exception 'Payment processing is not currently available';
    end if;
    v_settlement_status := 'collected_via_payment';
  else
    if v_seller_type = 'parent' and not public.is_profile_fully_verified(v_seller_profile_id) then
      raise exception 'This seller is not currently eligible to accept cash payments';
    end if;

    select is_enabled into v_cash_enabled from public.cash_settings where id;
    if not coalesce(v_cash_enabled, false) then
      raise exception 'Cash payments are currently unavailable';
    end if;

    select eligible, failed_criteria into v_eligible, v_failed_criteria
    from public.evaluate_cash_eligibility(v_seller_type, v_seller_profile_id, v_business_id);

    perform public.record_seller_cash_status(v_seller_type, v_seller_profile_id, v_business_id, v_eligible, v_failed_criteria);

    if not v_eligible then
      raise exception 'This seller is not currently eligible to accept cash payments';
    end if;

    v_provider_id := null;
    v_settlement_status := 'owed_by_seller';
  end if;

  insert into public.orders (
    buyer_id, seller_type, seller_profile_id, business_id, fulfilment_type, payment_method, status,
    subtotal_cents, delivery_fee_cents, total_cents, commission_rate_bps, commission_amount_cents,
    currency, delivery_location_id
  ) values (
    v_buyer_id, v_seller_type, v_seller_profile_id, v_business_id, p_fulfilment_type, p_payment_method, 'pending_payment',
    v_price_cents, v_delivery_fee_cents, v_total_cents, v_rate_bps, v_commission_cents,
    v_currency, v_delivery_location_id
  )
  returning id, orders.order_reference into v_order_id, v_order_reference;

  if p_fulfilment_type = 'delivery' then
    update public.delivery_quotes set order_id = v_order_id where id = p_delivery_quote_id;
  end if;

  insert into public.order_items (order_id, product_id, title_snapshot, price_cents_snapshot, quantity)
  values (v_order_id, p_product_id, v_title, v_price_cents, 1);

  insert into public.payments (order_id, provider_id, method, status, amount_cents, currency)
  values (v_order_id, v_provider_id, p_payment_method, 'pending', v_total_cents, v_currency);

  insert into public.commissions (order_id, seller_type, rate_bps, base_amount_cents, commission_amount_cents, settlement_status)
  values (v_order_id, v_seller_type, v_rate_bps, v_price_cents, v_commission_cents, v_settlement_status);

  if p_fulfilment_type = 'collection' then
    loop
      v_rand_bytes := gen_random_bytes(4);
      v_collection_code := lpad(
        (
          (
            (get_byte(v_rand_bytes, 0)::bigint << 24)
            | (get_byte(v_rand_bytes, 1)::bigint << 16)
            | (get_byte(v_rand_bytes, 2)::bigint << 8)
            | get_byte(v_rand_bytes, 3)::bigint
          ) % 1000000
        )::text,
        6, '0'
      );
      v_attempts := v_attempts + 1;
      exit when not exists (select 1 from public.collection_confirmations where collection_code = v_collection_code);
      if v_attempts > 20 then
        raise exception 'Could not generate a unique collection code';
      end if;
    end loop;

    insert into public.collection_confirmations (order_id, collection_code)
    values (v_order_id, v_collection_code);
  end if;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (
    v_order_id, 'order', v_order_id, 'order.created', 'buyer', v_buyer_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'order_reference', v_order_reference,
      'fulfilment_type', p_fulfilment_type,
      'payment_method', p_payment_method,
      'subtotal_cents', v_price_cents,
      'delivery_fee_cents', v_delivery_fee_cents,
      'total_cents', v_total_cents,
      'commission_rate_bps', v_rate_bps,
      'commission_amount_cents', v_commission_cents
    )
  );

  if p_payment_method = 'cash' then
    insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
    values (
      v_order_id, 'order', v_order_id, 'cash_order.pending_seller_acceptance', 'buyer', v_buyer_id,
      jsonb_build_object('collection_code_generated', true)
    );
  end if;

  return query select v_order_id, v_order_reference;
end;
$$;

revoke execute on function public.create_order(uuid, fulfilment_type, payment_method, uuid) from public, anon;
grant execute on function public.create_order(uuid, fulfilment_type, payment_method, uuid) to authenticated;

-- 3. Delivery booking (§11/§12 of the phase brief): PL/pgSQL cannot call
--    an external courier API, so the actual provider.bookDelivery()
--    call has to happen in application code
--    (src/server/delivery/bookingService.ts, service-role client,
--    called from the PayFast webhook route once payment is confirmed —
--    never before, never directly from the browser). Every DB state
--    transition around that call is still one atomic SQL function each,
--    matching every other money-moving write in this schema
--    (create_order(), process_payfast_itn(), accept_cash_order(), ...),
--    never a scattered sequence of separate application-level .update()
--    calls against orders/delivery_orders/transaction_events.
--
--    reserve_delivery_order() runs BEFORE the provider is contacted —
--    it's the idempotency guard. delivery_orders.order_id is UNIQUE
--    (20260920090700_delivery.sql), so a second call for the same order
--    (a retried/duplicate PayFast webhook, or two overlapping webhook
--    deliveries) gets NULL back and the caller stops before ever
--    calling the provider a second time — the guarantee comes from the
--    database constraint under `on conflict do nothing`, not from any
--    application-level locking.
create function public.reserve_delivery_order(
  p_order_id uuid,
  p_quote_id uuid,
  p_provider_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery_order_id uuid;
begin
  if not exists (select 1 from public.orders where id = p_order_id and fulfilment_type = 'delivery') then
    raise exception 'Order % is not a delivery order', p_order_id;
  end if;

  insert into public.delivery_orders (order_id, quote_id, provider_id, status)
  values (p_order_id, p_quote_id, p_provider_id, 'pending')
  on conflict (order_id) do nothing
  returning id into v_delivery_order_id;

  return v_delivery_order_id;
end;
$$;

revoke all on function public.reserve_delivery_order(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_delivery_order(uuid, uuid, uuid) to service_role;

-- record_delivery_booking() runs AFTER the provider call returns
-- (success or failure) — the one atomic write of its outcome. 'booked'
-- additionally advances the parent order from 'confirmed' to
-- 'awaiting_delivery' (an order_status value the foundation phase
-- already reserved for exactly this — see DECISIONS.md) and records a
-- transaction_event; any other status just records the delivery_orders
-- row and a transaction_event, without touching orders.status — a
-- failed booking attempt leaves the order at 'confirmed' (payment
-- already succeeded, so it is never silently reverted). Reconciling a
-- failed/stuck booking is an explicit open item in this phase's report,
-- not solved here.
create function public.record_delivery_booking(
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
begin
  update public.delivery_orders
  set provider_tracking_ref = p_provider_tracking_ref, status = p_status, updated_at = now()
  where id = p_delivery_order_id
  returning order_id into v_order_id;

  if not found then
    raise exception 'Delivery order % not found', p_delivery_order_id;
  end if;

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

-- 4. Delivery tracking (§15 of the phase brief's polling foundation):
--    one atomic sync of a freshly-polled provider status
--    (src/server/delivery/trackingService.ts calls
--    DeliveryProvider.getStatus(), then this function) into both
--    delivery_orders.status and, where it implies a real order-state
--    change, orders.status. The mock provider today only ever produces
--    'booked' (see src/server/delivery/providers/mock.ts —
--    bookDelivery() is the only thing that ever sets a status, and
--    nothing currently advances it further), so 'collected_by_courier'/
--    'in_transit'/'delivered' are handled correctly here but are not
--    reachable through the application today — see this phase's own
--    report rather than claiming otherwise. 'failed'/'cancelled' leave
--    orders.status untouched for the same "never silently revert a paid
--    order" reason as record_delivery_booking() above.
create function public.sync_delivery_status(p_order_id uuid, p_status delivery_order_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.delivery_orders set status = p_status, updated_at = now() where order_id = p_order_id;
  if not found then
    raise exception 'No delivery_orders row for order %', p_order_id;
  end if;

  if p_status in ('collected_by_courier', 'in_transit') then
    update public.orders set status = 'in_transit' where id = p_order_id and status in ('awaiting_delivery', 'in_transit');
  elsif p_status = 'delivered' then
    update public.orders set status = 'completed', completed_at = now() where id = p_order_id and status in ('awaiting_delivery', 'in_transit');
  end if;
end;
$$;

revoke all on function public.sync_delivery_status(uuid, delivery_order_status) from public, anon, authenticated;
grant execute on function public.sync_delivery_status(uuid, delivery_order_status) to service_role;
