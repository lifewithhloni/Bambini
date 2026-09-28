-- Phase 14C: in-app notifications.
--
-- AUDIT FINDING (read before touching anything below): the foundation
-- schema already created public.notifications (profile_id, type, title,
-- body, data, read_at, created_at, an index on (profile_id, created_at
-- desc), RLS enabled with a select-own and an update-own policy). Nothing
-- in the application ever wrote to it. No email/SMS/push provider, no
-- realtime channel, no cron and no notification preference model exist.
-- The event architecture DOES exist: public.transaction_events is an
-- append-only audit log with stable ids, written by every payment, order,
-- cash, delivery and dispute function. So no new table is needed; this
-- migration hardens the existing one and adds server-side producers.
--
-- Gaps in the existing table, closed here:
--   1. Idempotency: nothing stopped the same underlying event producing
--      the same notification twice. Adds event_key + a unique index on
--      (profile_id, event_key); producers insert ON CONFLICT DO NOTHING.
--   2. `type` was free-form text. Now a CHECK against the controlled list
--      of types that correspond to events actually produced below.
--   3. The update-own policy let a recipient rewrite ANY column of their
--      own notification (title, body, data, even created_at). Column
--      grants now allow UPDATE of read_at only, and a trigger makes
--      read_at server-authoritative (set to now(), never cleared).
--   4. No client may create or delete notifications at all: INSERT and
--      DELETE are revoked from authenticated/anon. Producers are internal
--      SECURITY DEFINER functions with EXECUTE revoked from every client
--      role, so they cannot be called as a notification-insertion API.
--
-- Recipients are always derived in the database from the event's own rows
-- (orders, message_threads, disputes, payouts, verifications) using the
-- existing owner-or-member business model — never from client input.
-- Notification text is fixed per event and deliberately carries nothing
-- sensitive: no message bodies, amounts, addresses, reasons, admin notes or
-- provider data. Deep links are NOT stored; `data` holds only opaque
-- reference ids and the app derives the href from (type, data).
--
-- Producers run inside the same transaction as the event they describe, so
-- each is wrapped in an exception handler that downgrades any failure to a
-- WARNING: a notification problem must never abort a payment, webhook or
-- admin decision.

-- 1-2. Idempotency key + controlled types ----------------------------------
alter table public.notifications add column event_key text;
update public.notifications set event_key = 'legacy:' || id::text where event_key is null;
alter table public.notifications alter column event_key set not null;

create unique index notifications_profile_event_key on public.notifications (profile_id, event_key);
create index notifications_profile_unread_idx on public.notifications (profile_id) where read_at is null;

alter table public.notifications add constraint notifications_type_known check (
  type in ('order_updated', 'payment_updated', 'delivery_updated', 'dispute_updated', 'message_received', 'verification_updated', 'payout_updated')
);
alter table public.notifications add constraint notifications_text_bounds check (
  char_length(title) between 1 and 120 and (body is null or char_length(body) <= 300)
);

-- 3-4. Recipient-only, read_at-only writes ------------------------------------
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy notifications_update_own_mark_read on public.notifications;
create policy notifications_update_own_mark_read on public.notifications
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create function public.notifications_read_at_server_set()
returns trigger
language plpgsql
as $$
begin
  if new.read_at is distinct from old.read_at then
    new.read_at := coalesce(old.read_at, now());
  end if;
  return new;
end;
$$;

create trigger notifications_read_at_server_set
  before update on public.notifications
  for each row execute function public.notifications_read_at_server_set();

-- Internal producers -----------------------------------------------------------
create function public.push_notification(
  p_profile_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb,
  p_event_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null then
    return;
  end if;
  insert into public.notifications (profile_id, type, title, body, data, event_key)
  values (p_profile_id, p_type, p_title, p_body, p_data, p_event_key)
  on conflict (profile_id, event_key) do nothing;
end;
$$;

-- The owner plus every member — the same set is_business_member() accepts.
-- business_members.role is deliberately not a permission tier here either.
create function public.notification_business_recipients(p_business_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_profile_id from public.businesses where id = p_business_id
  union
  select profile_id from public.business_members where business_id = p_business_id;
$$;

create function public.notify_order_audience(
  p_order_id uuid,
  p_audience text,
  p_type text,
  p_title text,
  p_body text,
  p_event_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_recipient uuid;
begin
  select buyer_id, seller_profile_id, business_id into v_order from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  if p_audience = 'buyer' then
    perform public.push_notification(v_order.buyer_id, p_type, p_title, p_body, jsonb_build_object('order_id', p_order_id, 'audience', 'buyer'), p_event_key);
  elsif v_order.business_id is not null then
    for v_recipient in select * from public.notification_business_recipients(v_order.business_id) loop
      perform public.push_notification(
        v_recipient, p_type, p_title, p_body,
        jsonb_build_object('order_id', p_order_id, 'audience', 'seller', 'business_id', v_order.business_id),
        p_event_key
      );
    end loop;
  else
    perform public.push_notification(v_order.seller_profile_id, p_type, p_title, p_body, jsonb_build_object('order_id', p_order_id, 'audience', 'seller'), p_event_key);
  end if;
end;
$$;

-- One unread "new message" notification per conversation at a time, so a
-- burst of messages doesn't bury the inbox; the next message after it is
-- read produces a fresh one.
create function public.push_message_notification(p_profile_id uuid, p_thread_id uuid, p_message_id uuid, p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null then
    return;
  end if;
  if exists (
    select 1 from public.notifications
    where profile_id = p_profile_id and type = 'message_received' and read_at is null and data ->> 'thread_id' = p_thread_id::text
  ) then
    return;
  end if;
  perform public.push_notification(
    p_profile_id, 'message_received', 'New message', 'You have a new message about a listing.',
    jsonb_build_object('thread_id', p_thread_id) || case when p_business_id is null then '{}'::jsonb else jsonb_build_object('business_id', p_business_id) end,
    'msg:' || p_message_id::text
  );
end;
$$;

-- Event source 1: transaction_events (append-only, stable ids) ---------------------
create function public.notify_on_transaction_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'txe:' || new.id::text;
begin
  begin
    if new.order_id is null then
      return null;
    end if;

    case new.event_type
      when 'cash_order.pending_seller_acceptance' then
        perform public.notify_order_audience(new.order_id, 'seller', 'order_updated', 'New cash order', 'A buyer placed a cash order. Open it to accept or decline.', v_key);
      when 'cash_order.accepted' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'order_updated', 'Order accepted', 'The seller accepted your cash order.', v_key);
      when 'cash_order.declined' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'order_updated', 'Order declined', 'The seller declined your cash order.', v_key);
      when 'collection.confirmed' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'order_updated', 'Collection confirmed', 'The seller confirmed your collection.', v_key);
      when 'payment.confirmed' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'payment_updated', 'Payment received', 'Your payment was confirmed.', v_key);
        perform public.notify_order_audience(new.order_id, 'seller', 'payment_updated', 'Payment received', 'A buyer''s payment for one of your orders was confirmed.', v_key);
      when 'payment.failed' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'payment_updated', 'Payment failed', 'Your payment didn''t go through. Open your order to see your options.', v_key);
      when 'delivery.booked' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'delivery_updated', 'Delivery booked', 'Delivery has been arranged for your order.', v_key);
        perform public.notify_order_audience(new.order_id, 'seller', 'delivery_updated', 'Delivery booked', 'Delivery has been booked for one of your orders.', v_key);
      when 'dispute.opened' then
        perform public.notify_order_audience(new.order_id, 'seller', 'dispute_updated', 'Dispute opened', 'A buyer opened a dispute on an order. Open it to respond.', v_key);
      when 'dispute.seller_responded' then
        perform public.notify_order_audience(new.order_id, 'buyer', 'dispute_updated', 'Seller responded', 'The seller responded to your dispute.', v_key);
      else
        null;
    end case;
  exception when others then
    raise warning 'notification skipped for transaction event %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger transaction_events_notify
  after insert on public.transaction_events
  for each row execute function public.notify_on_transaction_event();

-- Event source 2: disputes resolved (the resolution writes admin_actions, not a transaction event)
create function public.notify_on_dispute_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'dispute:' || new.id::text || ':' || new.status::text;
begin
  begin
    perform public.notify_order_audience(new.order_id, 'buyer', 'dispute_updated', 'Dispute resolved', 'A dispute on your order has been resolved. Open the order for details.', v_key);
    perform public.notify_order_audience(new.order_id, 'seller', 'dispute_updated', 'Dispute resolved', 'A dispute on one of your orders has been resolved. Open the order for details.', v_key);
  exception when others then
    raise warning 'notification skipped for dispute %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger disputes_notify_resolved
  after update of status on public.disputes
  for each row
  when (old.status is distinct from new.status and new.status in ('resolved_buyer', 'resolved_seller', 'resolved_partial'))
  execute function public.notify_on_dispute_resolved();

-- Event source 3: messages (own table, stable id, no realtime needed) --------------
create function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread record;
  v_recipient uuid;
begin
  begin
    select buyer_id, seller_profile_id, business_id into v_thread from public.message_threads where id = new.thread_id;
    if not found then
      return null;
    end if;

    if new.sender_id = v_thread.buyer_id then
      if v_thread.business_id is not null then
        for v_recipient in select * from public.notification_business_recipients(v_thread.business_id) loop
          perform public.push_message_notification(v_recipient, new.thread_id, new.id, v_thread.business_id);
        end loop;
      else
        perform public.push_message_notification(v_thread.seller_profile_id, new.thread_id, new.id, null);
      end if;
    else
      perform public.push_message_notification(v_thread.buyer_id, new.thread_id, new.id, null);
    end if;
  exception when others then
    raise warning 'notification skipped for message %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_on_message();

-- Event source 4: identity / business verification decisions ------------------------
-- Only the decision is surfaced (approved / not approved). Reviewer identity,
-- notes, documents and ID numbers never enter a notification.
create function public.notify_on_identity_verification_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.push_notification(
      new.profile_id, 'verification_updated',
      case new.status when 'verified' then 'Identity verified' else 'Identity verification not approved' end,
      case new.status when 'verified' then 'Your identity verification was approved.' else 'Your identity verification wasn''t approved. Open verification to see what to do next.' end,
      jsonb_build_object('kind', 'identity', 'status', new.status::text),
      'idv:' || new.id::text || ':' || new.status::text
    );
  exception when others then
    raise warning 'notification skipped for identity verification %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger identity_verifications_notify
  after update of status on public.identity_verifications
  for each row
  when (old.status is distinct from new.status and new.status in ('verified', 'rejected'))
  execute function public.notify_on_identity_verification_decision();

create function public.notify_on_business_verification_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  begin
    for v_recipient in select * from public.notification_business_recipients(new.business_id) loop
      perform public.push_notification(
        v_recipient, 'verification_updated',
        case new.status when 'verified' then 'Business verified' else 'Business verification not approved' end,
        case new.status when 'verified' then 'Your business verification was approved.' else 'Your business verification wasn''t approved. Open your business to see what to do next.' end,
        jsonb_build_object('kind', 'business', 'status', new.status::text, 'business_id', new.business_id),
        'bv:' || new.id::text || ':' || new.status::text
      );
    end loop;
  exception when others then
    raise warning 'notification skipped for business verification %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger business_verifications_notify
  after update of status on public.business_verifications
  for each row
  when (old.status is distinct from new.status and new.status in ('verified', 'rejected'))
  execute function public.notify_on_business_verification_decision();

-- Event source 5: payout outcome (status transition; amounts are never included) ----
create function public.notify_on_payout_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_title text := case new.status when 'paid' then 'Payout paid' else 'Payout problem' end;
  v_body text := case new.status when 'paid' then 'Your payout has been paid.' else 'A payout couldn''t be completed. Open payouts for details.' end;
  v_key text := 'payout:' || new.id::text || ':' || new.status::text;
begin
  begin
    if new.recipient_business_id is not null then
      for v_recipient in select * from public.notification_business_recipients(new.recipient_business_id) loop
        perform public.push_notification(v_recipient, 'payout_updated', v_title, v_body, jsonb_build_object('business_id', new.recipient_business_id), v_key);
      end loop;
    else
      perform public.push_notification(new.recipient_profile_id, 'payout_updated', v_title, v_body, '{}'::jsonb, v_key);
    end if;
  exception when others then
    raise warning 'notification skipped for payout %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger payouts_notify_outcome
  after update of status on public.payouts
  for each row
  when (old.status is distinct from new.status and new.status in ('paid', 'failed'))
  execute function public.notify_on_payout_outcome();

-- Nothing here is callable by a client role: producers run only via triggers.
revoke all on function public.push_notification(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.notification_business_recipients(uuid) from public, anon, authenticated;
revoke all on function public.notify_order_audience(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.push_message_notification(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.notify_on_transaction_event() from public, anon, authenticated;
revoke all on function public.notify_on_dispute_resolved() from public, anon, authenticated;
revoke all on function public.notify_on_message() from public, anon, authenticated;
revoke all on function public.notify_on_identity_verification_decision() from public, anon, authenticated;
revoke all on function public.notify_on_business_verification_decision() from public, anon, authenticated;
revoke all on function public.notify_on_payout_outcome() from public, anon, authenticated;
revoke all on function public.notifications_read_at_server_set() from public, anon, authenticated;
