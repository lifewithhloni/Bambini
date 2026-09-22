-- Phase 9: disputes & transaction protection.
--
-- AUDIT FINDING (read before touching anything below): the foundation
-- migrations already anticipated this entire phase and left the pieces
-- sitting dormant, unused by any function until now:
--   - public.disputes (20260920091100_notifications_reports_disputes.sql)
--     already has id/order_id/raised_by/reason/description/status/
--     resolution_notes/resolved_by/resolved_at/created_at/updated_at,
--     RLS already enabled, an updated_at trigger already wired
--     (20260920091300_functions_and_triggers.sql), and
--     evaluate_cash_eligibility() (Phase 4C) ALREADY counts
--     disputes.status in ('open','under_review') as "unresolved" for
--     the max_unresolved_disputes cash-eligibility criterion — so this
--     migration does not touch that logic at all; it keeps writing the
--     exact same two status values that function has depended on since
--     Phase 4C.
--   - dispute_status already exists as a real enum ('open',
--     'under_review', 'resolved_buyer', 'resolved_seller',
--     'resolved_partial', 'closed') — this migration reuses it exactly
--     as-is, adding no new value. 'resolved_partial' is reused as this
--     phase's "no action / dismissed" outcome — the closest existing
--     value to "resolved without a clear win for either side"; adding a
--     redundant fourth resolution value alongside it would duplicate
--     what this enum already expresses.
--   - order_status already has a 'disputed' value that has NEVER been
--     written by any function in this codebase until this migration.
--     This is the single most important discovery driving this
--     migration's whole design: EVERY existing payout-eligibility read
--     path (get_seller_available_balance(), request_seller_payout(),
--     get_business_available_balance(), request_business_payout(),
--     create_seller_payout()'s own "must be completed" check, and
--     listPayoutEligibleOrders() in adminPayoutEligibility.ts) already
--     filters strictly on orders.status = 'completed'. Moving a
--     disputed order's status to 'disputed' therefore makes it
--     automatically, correctly ineligible for payout everywhere, with
--     ZERO changes to any of those six read/write paths — exactly
--     "extend the existing architecture, not a competing parallel
--     system." No new payout-side dispute check was added anywhere;
--     none was needed.
--
-- DISPUTE ELIGIBILITY: an order may be disputed once it has moved past
-- 'pending_payment' (money has actually been committed — for an online
-- order via PayFast, for a cash order via accept_cash_order(), which
-- sets status = 'confirmed' before the cash itself changes hands at
-- collection) and before it reaches a terminal state (cancelled,
-- disputed already, or refunded). Concretely: status in ('confirmed',
-- 'ready_for_collection', 'awaiting_delivery', 'in_transit',
-- 'completed'). This uses orders.status alone, never a payments join —
-- payments.status only becomes 'paid' for a CASH order at collection
-- time, well after 'confirmed', so gating on payments.status='paid'
-- would incorrectly exclude legitimate early cash disputes (e.g.
-- collection_problem, seller no-show) that this phase's own reason list
-- explicitly anticipates.
--
-- DISPUTE WINDOW: NONE was found in the existing schema or application
-- (checked for a return-window/dispute-window config table and found
-- none; /orders/[orderId]/return is the PayFast redirect-back page, not
-- a product-return window). Per this phase's own instruction not to
-- invent an arbitrary period without a basis, no time-based cutoff is
-- implemented here — eligibility is governed purely by order state, not
-- elapsed time. This is a deliberate decision, not an oversight; see
-- this phase's final report for how to add one later if the product
-- ever wants it (a single new commission_rates-style config table plus
-- one extra check in open_dispute() against completed_at/created_at).
--
-- FINANCIAL PROTECTION, NOT A FAKE REFUND: resolve_dispute() never
-- writes to payments, payout_items, or payouts. A resolved_buyer
-- outcome leaves the order at status = 'disputed' permanently (never
-- restored to 'completed'), which is what keeps it permanently outside
-- every payout-eligibility formula above — an honest signal that this
-- order's proceeds are not clear for payout, without pretending a
-- refund was actually processed (no refund provider exists yet; see
-- the also-dormant, still-untouched refund_status enum and payments
-- 'refunded'/'partially_refunded' values, which remain for a genuinely
-- future phase). A resolved_seller or resolved_partial ("no action")
-- outcome restores the order to EXACTLY the status it held immediately
-- before the dispute opened (captured in
-- disputes.pre_dispute_order_status at open time) — not unconditionally
-- forced to 'completed', since a dispute can legitimately be opened
-- while an order is still 'in_transit'/'awaiting_delivery', and forcing
-- 'completed' on resolution would fabricate a delivery event that never
-- happened.
--
-- ALREADY-CLAIMED OR ALREADY-PAID ORDERS: opening a dispute never
-- touches payout_items or payouts. If a seller was already paid out
-- before a dispute is opened against that same order, this migration
-- deliberately does NOT reverse, delete, or flag that payout — per this
-- phase's own explicit instruction, that is a human/operational
-- decision for a future phase, not something to automate here. See the
-- final report's "unresolved issues" for this exact scenario.
--
-- WRITE PATH: disputes graduates from a plain RLS content table to the
-- same "zero direct client write, every write through a validated
-- SECURITY DEFINER function" shape every other trust-critical table in
-- this schema already uses (payouts, payments, orders). The existing
-- disputes_insert_participant policy is dropped because it currently
-- lets EITHER the buyer OR the seller directly insert a row — this
-- phase's own brief is explicit that only the buyer opens a dispute,
-- and RLS alone cannot cleanly express "buyer opens, seller only
-- responds" plus all the order-state/duplicate-active-dispute
-- validation below. disputes_update_admin is dropped for the same
-- reason resolution fields must be genuinely immutable outside the
-- functions below: even an admin's own ordinary session must not be
-- able to hand-edit a resolution, matching exactly the guarantee
-- Phase 8A/8B already established for payouts.status/amount_cents.
-- disputes_select_participant_or_admin is untouched — it already scopes
-- reads correctly (raised_by, or any order participant including
-- is_business_member(), or admin) and needs no change.

-- 1. Controlled dispute reasons --------------------------------------------
-- The table has never been written to by any function (only ever read
-- in an aggregate COUNT by evaluate_cash_eligibility()), so this
-- pre-production type change is safe with no data to migrate.
create type public.dispute_reason as enum (
  'item_not_received',
  'item_not_as_described',
  'damaged_item',
  'wrong_item',
  'delivery_problem',
  'collection_problem',
  'other'
);

alter table public.disputes alter column reason type dispute_reason using reason::dispute_reason;

-- 2. Seller response + pre-dispute order-status snapshot -------------------
alter table public.disputes
  add column seller_response text,
  add column seller_responded_at timestamptz,
  add column pre_dispute_order_status order_status;

-- 3. One active dispute per order, enforced at the database level --------
-- 'open'/'under_review' are the exact two values
-- evaluate_cash_eligibility() already treats as "unresolved" — this
-- index uses the same set deliberately, not a coincidence.
create unique index disputes_order_id_active_unique
  on public.disputes (order_id)
  where status in ('open', 'under_review');

-- 4. Lock down direct client writes ----------------------------------------
drop policy disputes_insert_participant on public.disputes;
drop policy disputes_update_admin on public.disputes;

-- 5. open_dispute(): buyer-only, atomic -------------------------------------
create function public.open_dispute(p_order_id uuid, p_reason dispute_reason, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_order record;
  v_dispute_id uuid;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  select id, buyer_id, status into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.buyer_id <> v_buyer_id then
    raise exception 'Only the buyer can open a dispute for this order';
  end if;

  -- Checked before the general eligibility check below: once a dispute
  -- is active, open_dispute() itself set orders.status = 'disputed',
  -- which would ALSO fail the eligibility check with a less specific
  -- message — checking for an existing active dispute first gives the
  -- caller the more accurate reason.
  if exists (select 1 from public.disputes where order_id = p_order_id and status in ('open', 'under_review')) then
    raise exception 'This order already has an active dispute';
  end if;

  if v_order.status not in ('confirmed', 'ready_for_collection', 'awaiting_delivery', 'in_transit', 'completed') then
    raise exception 'This order is not eligible for a dispute';
  end if;

  insert into public.disputes (order_id, raised_by, reason, description, status, pre_dispute_order_status)
  values (p_order_id, v_buyer_id, p_reason, p_description, 'open', v_order.status)
  returning id into v_dispute_id;

  update public.orders set status = 'disputed' where id = p_order_id;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (p_order_id, 'dispute', v_dispute_id, 'dispute.opened', 'buyer', v_buyer_id, jsonb_build_object('reason', p_reason));

  return v_dispute_id;
end;
$$;

revoke execute on function public.open_dispute(uuid, dispute_reason, text) from public, anon;
grant execute on function public.open_dispute(uuid, dispute_reason, text) to authenticated;

-- 6. respond_to_dispute(): seller-only (any business member for a
-- business order — an operational action, same authorization tier as
-- confirm_collection()/accept_cash_order(), never the owner-only tier
-- Phase 8C reserves for payout requests specifically) -----------------
create function public.respond_to_dispute(p_dispute_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_dispute record;
  v_order record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_response is null or length(trim(p_response)) = 0 then
    raise exception 'A response is required';
  end if;

  select id, order_id, status into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'Dispute not found';
  end if;

  if v_dispute.status not in ('open', 'under_review') then
    raise exception 'This dispute is no longer open for a response';
  end if;

  -- Filtered in the WHERE clause, not a separate IF — a parent order's
  -- business_id is null and a business order's seller_profile_id is
  -- null, and `null = v_user_id` is NULL (neither true nor false) in
  -- SQL's three-valued logic; folding the check into `not found` here
  -- avoids that trap entirely, the same proven idiom
  -- confirm_collection()/accept_cash_order() already use for this exact
  -- ownership check.
  select o.seller_profile_id, o.business_id into v_order
  from public.orders o
  where o.id = v_dispute.order_id
    and (o.seller_profile_id = v_user_id or public.is_business_member(o.business_id));

  if not found then
    raise exception 'You are not authorized to respond to this dispute';
  end if;

  update public.disputes
  set seller_response = p_response,
      seller_responded_at = now(),
      status = case when status = 'open' then 'under_review'::dispute_status else status end
  where id = p_dispute_id;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id)
  values (v_dispute.order_id, 'dispute', p_dispute_id, 'dispute.seller_responded', 'seller', v_user_id);
end;
$$;

revoke execute on function public.respond_to_dispute(uuid, text) from public, anon;
grant execute on function public.respond_to_dispute(uuid, text) to authenticated;

-- 7. resolve_dispute(): admin-only, atomic ----------------------------------
-- p_outcome is typed as dispute_status (not text) so a typo can never
-- silently create an invalid value, but only three of that type's six
-- values are ever accepted here — 'open'/'under_review'/'closed' are
-- explicitly rejected as outcomes, since they are not real resolutions.
create function public.resolve_dispute(p_dispute_id uuid, p_outcome dispute_status, p_resolution_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_dispute record;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  if p_outcome not in ('resolved_buyer', 'resolved_seller', 'resolved_partial') then
    raise exception 'Invalid resolution outcome';
  end if;

  if p_resolution_notes is null or length(trim(p_resolution_notes)) = 0 then
    raise exception 'Resolution notes are required';
  end if;

  select id, order_id, status, pre_dispute_order_status into v_dispute
  from public.disputes where id = p_dispute_id for update;

  if not found then
    raise exception 'Dispute not found';
  end if;

  if v_dispute.status not in ('open', 'under_review') then
    raise exception 'Only an open or under-review dispute can be resolved';
  end if;

  update public.disputes
  set status = p_outcome, resolution_notes = p_resolution_notes, resolved_by = v_admin_id, resolved_at = now()
  where id = p_dispute_id;

  if p_outcome in ('resolved_seller', 'resolved_partial') then
    -- Restore exactly the pre-dispute status — never unconditionally
    -- 'completed' (see this migration's own header for why).
    update public.orders set status = v_dispute.pre_dispute_order_status where id = v_dispute.order_id and status = 'disputed';
  end if;
  -- resolved_buyer: the order deliberately stays 'disputed' — see this
  -- migration's own header ("FINANCIAL PROTECTION, NOT A FAKE REFUND").

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'dispute.resolved', 'dispute', p_dispute_id, format('%s — %s', p_outcome, p_resolution_notes));
end;
$$;

revoke execute on function public.resolve_dispute(uuid, dispute_status, text) from public, anon;
grant execute on function public.resolve_dispute(uuid, dispute_status, text) to authenticated;

-- 8. close_dispute(): admin-only, purely archival ---------------------------
-- Never reachable from 'open'/'under_review' directly — a dispute must
-- be resolved first. No reopening mechanism exists (none was asked for
-- and this phase's own brief says not to build one unless necessary).
create function public.close_dispute(p_dispute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_status dispute_status;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  select status into v_status from public.disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'Dispute not found';
  end if;

  if v_status not in ('resolved_buyer', 'resolved_seller', 'resolved_partial') then
    raise exception 'Only a resolved dispute can be closed';
  end if;

  update public.disputes set status = 'closed' where id = p_dispute_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'dispute.closed', 'dispute', p_dispute_id, null);
end;
$$;

revoke execute on function public.close_dispute(uuid) from public, anon;
grant execute on function public.close_dispute(uuid) to authenticated;
