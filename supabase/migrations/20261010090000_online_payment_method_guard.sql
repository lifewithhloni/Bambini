-- Phase 12C: close a real gap found while auditing the existing PayFast
-- integration for the payment-execution phase.
--
-- record_payment_attempt() and process_payfast_itn() (both from
-- 20260926090000_payfast_payment_integration.sql) only ever checked
-- orders.status/payments.status before acting — neither one checked
-- payments.method. Cash orders are created with orders.status =
-- 'pending_payment' too (see create_order()'s p_payment_method branch,
-- 20260927090000_cash_collection_transactions.sql), identically to an
-- online order, before the seller has accepted them. The normal UI path
-- never exposes this (createOrder() redirects a cash order straight to
-- /account/orders/[id], never to /orders/[id]/pay), but nothing at the
-- database layer actually prevented a buyer who navigated directly to
-- /orders/{their-cash-order-id}/pay from having record_payment_attempt()
-- happily attach a PayFast provider_reference to it, or — if that
-- checkout were somehow completed — process_payfast_itn() marking a
-- cash order's payment 'paid' and its order 'confirmed' through the
-- online path entirely, bypassing seller acceptance and the collection
-- code flow. "Cash is collection only" is repeatedly documented in this
-- schema as a locked rule (see cash-collection.test.ts's own describe
-- block "cash + delivery is impossible"); this closes the same class of
-- gap one level earlier — cash orders must never enter the online
-- payment lifecycle at all, not just never combine with delivery.
--
-- Both functions keep their exact existing signature (CREATE OR REPLACE,
-- no DROP needed) — only one new check is added to each, using the
-- payments.method column that already exists.

create or replace function public.record_payment_attempt(
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
  v_payment_method payment_method;
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

  select p.id, p.status, p.method into v_payment_id, v_payment_status, v_payment_method
  from public.payments p
  where p.order_id = p_order_id
  for update;

  if not found then
    raise exception 'Payment record not found';
  end if;

  if v_payment_method <> 'online' then
    raise exception 'This order does not use online payment';
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

create or replace function public.process_payfast_itn(
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
  v_payment_method payment_method;
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

  select p.id, p.status, p.provider_reference, p.method
  into v_payment_id, v_payment_status, v_payment_reference, v_payment_method
  from public.payments p
  where p.order_id = p_order_id
  for update;

  if not found then
    return query select 'rejected_not_found'::text;
    return;
  end if;

  -- Defense in depth alongside record_payment_attempt()'s own guard
  -- above: even if a PayFast checkout were somehow initiated for a cash
  -- order, the one place that actually flips payment/order state to
  -- paid/confirmed still refuses to do so for a non-online payment.
  if v_payment_method <> 'online' then
    return query select 'rejected_wrong_payment_method'::text;
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
