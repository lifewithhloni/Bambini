-- Phase 4B: online payments (PayFast).
--
-- The payment-provider abstraction (PaymentProvider interface,
-- registry, payment_providers table) already existed, unused, since
-- the foundation phase — nothing about that architecture changes here.
-- What this migration actually adds:
--
-- 1. A seeded `payfast` payment_providers row (inactive by default —
--    see below).
-- 2. create_order() (Phase 4A) is redefined via CREATE OR REPLACE
--    (same signature, same return columns — only the body changes, so
--    no DROP is required, unlike the Phase 3B nearby-search change
--    which altered return columns). The only actual change: the
--    payments row it creates now attaches whichever payment_providers
--    row has is_active = true, instead of the hardcoded 'mock' slug
--    Phase 4A shipped with (the only real provider that existed then).
--    Operational note: PAYMENT_PROVIDER (the application-level env var
--    selecting which adapter code runs) and payment_providers.is_active
--    (the database-level flag selecting which provider a NEW order
--    attaches to) are two independent switches that must be changed
--    together — see DECISIONS.md.
-- 3. record_payment_attempt() — SECURITY DEFINER, mirrors create_order()'s
--    own justification exactly: no UPDATE policy exists for
--    `authenticated` on `payments`, so a buyer paying for their own
--    order still needs an elevated, narrowly-scoped path to attach a
--    provider reference to it. Re-validates ownership/order status/
--    payment status from auth.uid() every time, never trusts a
--    parameter for identity.
-- 4. process_payfast_itn() — deliberately NOT SECURITY DEFINER. Its
--    only legitimate caller is the webhook route handler, using the
--    service-role client (createAdminClient()), which already bypasses
--    RLS on every statement regardless of the function's own security
--    mode — SECURITY DEFINER would add no real privilege boundary here,
--    unlike create_order()/record_payment_attempt(), whose caller is an
--    ordinary `authenticated` user with no privilege at all. EXECUTE is
--    revoked from PUBLIC/anon/authenticated and granted only to
--    service_role — the real protection against a normal user calling
--    this directly to fake a payment confirmation.
-- 5. A partial unique index on payments.provider_reference — prevents
--    two different orders' payments rows from ever ending up with the
--    same provider reference (defense-in-depth data-integrity
--    invariant; the payment lifecycle itself doesn't create duplicate
--    rows regardless, since payments.order_id is already unique).

insert into public.payment_providers (slug, name, is_active, config)
values ('payfast', 'PayFast', false, '{}'::jsonb);

create unique index payments_provider_reference_idx
  on public.payments (provider_reference)
  where provider_reference is not null;

create or replace function public.create_order(
  p_product_id uuid,
  p_fulfilment_type fulfilment_type
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
  v_rate_bps integer;
  v_commission_cents bigint;
  v_provider_id uuid;
  v_delivery_location_id uuid;
  v_order_id uuid;
  v_order_reference text;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  update public.products
  set status = 'sold'
  where id = p_product_id and status = 'published'
  returning seller_type, seller_profile_id, business_id, title, price_cents, currency,
    collection_available, delivery_available
  into v_seller_type, v_seller_profile_id, v_business_id, v_title, v_price_cents, v_currency,
    v_collection_available, v_delivery_available;

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

  -- Phase 4B change: was `where slug = 'mock' and is_active` — now
  -- attaches whichever provider is actually active, so a real PayFast
  -- (or future) integration isn't permanently pinned to the mock
  -- adapter regardless of PAYMENT_PROVIDER/is_active configuration.
  select id into v_provider_id from public.payment_providers where is_active limit 1;
  if v_provider_id is null then
    raise exception 'Payment processing is not currently available';
  end if;

  insert into public.orders (
    buyer_id, seller_type, seller_profile_id, business_id, fulfilment_type, payment_method, status,
    subtotal_cents, delivery_fee_cents, total_cents, commission_rate_bps, commission_amount_cents,
    currency, delivery_location_id
  ) values (
    v_buyer_id, v_seller_type, v_seller_profile_id, v_business_id, p_fulfilment_type, 'online', 'pending_payment',
    v_price_cents, 0, v_price_cents, v_rate_bps, v_commission_cents,
    v_currency, v_delivery_location_id
  )
  returning id, orders.order_reference into v_order_id, v_order_reference;

  insert into public.order_items (order_id, product_id, title_snapshot, price_cents_snapshot, quantity)
  values (v_order_id, p_product_id, v_title, v_price_cents, 1);

  insert into public.payments (order_id, provider_id, method, status, amount_cents, currency)
  values (v_order_id, v_provider_id, 'online', 'pending', v_price_cents, v_currency);

  insert into public.commissions (order_id, seller_type, rate_bps, base_amount_cents, commission_amount_cents)
  values (v_order_id, v_seller_type, v_rate_bps, v_price_cents, v_commission_cents);

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (
    v_order_id, 'order', v_order_id, 'order.created', 'buyer', v_buyer_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'order_reference', v_order_reference,
      'fulfilment_type', p_fulfilment_type,
      'subtotal_cents', v_price_cents,
      'commission_rate_bps', v_rate_bps,
      'commission_amount_cents', v_commission_cents
    )
  );

  return query select v_order_id, v_order_reference;
end;
$$;

-- Payment initiation: attaches a provider reference to the order's
-- existing payments row (never inserts a second one — payments.order_id
-- is already unique) and records payment.initiated. Re-entrant: a
-- buyer clicking "Pay now" again while the payment is still `pending`
-- or after it went `failed` generates a fresh provider reference and
-- is treated as a legitimate retry; a `paid`/`refunded`/
-- `partially_refunded` payment can never be re-initiated — "a completed
-- payment must never be replaced by a new payment attempt."
create function public.record_payment_attempt(
  p_order_id uuid,
  p_provider_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_order_status order_status;
  v_payment_id uuid;
  v_payment_status payment_status;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  select o.status into v_order_status
  from public.orders o
  where o.id = p_order_id and o.buyer_id = v_buyer_id;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order_status <> 'pending_payment' then
    raise exception 'Order is not payable';
  end if;

  select p.id, p.status into v_payment_id, v_payment_status
  from public.payments p
  where p.order_id = p_order_id
  for update;

  if not found then
    raise exception 'Payment record not found';
  end if;

  if v_payment_status not in ('pending', 'failed') then
    raise exception 'This order has already been paid';
  end if;

  update public.payments
  set status = 'pending', provider_reference = p_provider_reference
  where id = v_payment_id;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (
    p_order_id, 'payment', v_payment_id, 'payment.initiated', 'buyer', v_buyer_id,
    jsonb_build_object('provider_reference', p_provider_reference)
  );
end;
$$;

revoke execute on function public.record_payment_attempt(uuid, text) from public, anon;
grant execute on function public.record_payment_attempt(uuid, text) to authenticated;

-- Webhook processing: called only by the PayFast webhook route handler
-- (service-role client), only after that route has independently
-- verified the PayFast signature, host, and /eng/query/validate
-- confirmation, and parsed a safe status/amount. This function's own
-- job is the atomic, idempotent, state-machine-safe DB mutation —
-- nothing here re-verifies PayFast authenticity (that's the adapter's
-- job, not SQL's), but it DOES independently re-verify the amount
-- against orders.total_cents, since that's Bambini's own authoritative
-- value, not something to trust a second time from the caller.
create function public.process_payfast_itn(
  p_order_id uuid,
  p_provider_reference text,
  p_status text,
  p_amount_cents bigint
)
returns table (outcome text)
language plpgsql
set search_path = public
as $$
declare
  v_order_total_cents bigint;
  v_payment_id uuid;
  v_payment_status payment_status;
  v_payment_reference text;
begin
  if p_status not in ('paid', 'failed') then
    return query select 'rejected_invalid_status'::text;
    return;
  end if;

  select o.total_cents into v_order_total_cents
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return query select 'rejected_not_found'::text;
    return;
  end if;

  if v_order_total_cents <> p_amount_cents then
    return query select 'rejected_amount_mismatch'::text;
    return;
  end if;

  select p.id, p.status, p.provider_reference
  into v_payment_id, v_payment_status, v_payment_reference
  from public.payments p
  where p.order_id = p_order_id
  for update;

  if not found then
    return query select 'rejected_not_found'::text;
    return;
  end if;

  -- Terminal-state protection: PAID is never downgraded by a later or
  -- out-of-order event, regardless of what that event claims.
  if v_payment_status = 'paid' then
    return query select 'duplicate_ignored'::text;
    return;
  end if;

  -- Idempotency: an exact repeat of an already-recorded failure for the
  -- same provider reference is a no-op, not a second event.
  if v_payment_status = 'failed' and p_status = 'failed' and v_payment_reference = p_provider_reference then
    return query select 'duplicate_ignored'::text;
    return;
  end if;

  if p_status = 'paid' then
    update public.payments
    set status = 'paid', provider_reference = p_provider_reference
    where id = v_payment_id;

    -- Payment confirmation moves the order to 'confirmed' — the
    -- foundation phase's own order_status enum already has this state
    -- for exactly this purpose (see DECISIONS.md); it does not become
    -- 'completed' (that's fulfilment, a later phase's concern) and
    -- there is no separate 'paid' order_status value to introduce.
    update public.orders
    set status = 'confirmed'
    where id = p_order_id and status = 'pending_payment';

    insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, payload)
    values (
      p_order_id, 'payment', v_payment_id, 'payment.confirmed', 'payment_provider',
      jsonb_build_object('provider_reference', p_provider_reference, 'amount_cents', p_amount_cents)
    );

    return query select 'confirmed'::text;
  else
    update public.payments
    set status = 'failed', provider_reference = p_provider_reference
    where id = v_payment_id;

    -- orders.status deliberately stays at 'pending_payment' — the order
    -- remains payable/retryable, and the listing stays 'sold' (no
    -- automatic "unsold" reversal; see DECISIONS.md for why that's an
    -- explicit future decision, not an unsafe shortcut here).
    insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, payload)
    values (
      p_order_id, 'payment', v_payment_id, 'payment.failed', 'payment_provider',
      jsonb_build_object('provider_reference', p_provider_reference, 'amount_cents', p_amount_cents)
    );

    return query select 'failed_recorded'::text;
  end if;
end;
$$;

revoke all on function public.process_payfast_itn(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.process_payfast_itn(uuid, text, text, bigint) to service_role;
