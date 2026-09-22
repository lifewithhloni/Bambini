-- Phase 8A: seller settlement & payout ledger.
--
-- Audit finding (this phase's own §1, verified empirically before
-- writing anything): payouts/payout_items have existed, fully shaped
-- and RLS-protected, since the foundation migration
-- (20260920090600_payouts_and_refunds.sql) — but zero function in this
-- entire migration history has ever written to either table. The
-- schema was correct in outline; nothing was actually wired up. Two
-- real gaps existed in the schema itself, both fixed here:
--
-- 1. payout_items' primary key is (payout_id, order_id) — this only
--    prevents the SAME order appearing twice WITHIN one payout, not the
--    same order being claimed by two DIFFERENT payouts. A standalone
--    UNIQUE(order_id) is the actual double-payout guarantee.
-- 2. No write path existed at all — every write to a money-moving table
--    in this schema goes through a SECURITY DEFINER function (orders,
--    payments, commissions, delivery_orders, ... — see this migration's
--    own precedent throughout the project), never a raw client insert;
--    payouts/payout_items had no such function.
--
-- Design decisions made deliberately, not by default:
--
-- - Payout eligibility is a DERIVED fact (orders.status = 'completed'
--   AND payment_method = 'online' AND no existing payout_items row),
--   never a new stored status. orders.status already has 'completed'
--   as the one lifecycle event both fulfilment paths converge on
--   (confirm_collection() for collection, sync_delivery_status() for
--   delivery — both already set completed_at, which doubles as "when
--   did this become eligible" with no new column needed). Introducing
--   a parallel "eligible_for_settlement" enum value would duplicate
--   information orders.status already carries exactly.
-- - payout_status (pending/processing/paid/failed) already existed and
--   already covers a payout's own lifecycle — reused as-is, no new
--   enum. "cancelled"/"reversed" are deliberately NOT added: nothing in
--   this phase produces them (refunds are explicitly out of scope), and
--   inventing unused enum values now would be guessing at a design this
--   phase's own brief says to defer.
-- - Cash orders are permanently ineligible for payout, enforced inside
--   create_seller_payout() itself — the seller already collected
--   payment directly from the buyer; commissions.settlement_status
--   'owed_by_seller' (unchanged, Phase 4C) already represents the
--   correct, opposite-direction debt. No payout row is ever created for
--   a cash order; this is not a special case to remember, it is a
--   condition this function actively rejects.
-- - A failed payout's payout_items rows are deliberately NOT deleted —
--   doing so would silently make those orders eligible for a new
--   payout attempt, which is unsafe to do automatically for the same
--   reason Phase 7B's stuck-delivery reconciliation is manual-only: a
--   payout marked "failed" might have actually succeeded through a
--   channel this system can't observe, and an automatic retry could
--   double-pay a seller in the real world even though the ledger would
--   look clean. This is a real, open limitation, not an oversight — see
--   the phase report's own "unresolved issues".

-- 1. Double-payout protection ---------------------------------------------
alter table public.payout_items
  add constraint payout_items_order_id_unique unique (order_id);

-- 2. create_seller_payout(): admin-only, atomic ---------------------------
-- Locks every target order first (`for update`) — a second, concurrent
-- call touching any of the same orders blocks here until this
-- transaction commits or rolls back, so its own later
-- "already in payout_items" check always sees accurate, committed
-- state rather than racing against it. The UNIQUE constraint above is
-- the final, irreducible guarantee even if this logic ever had a bug.
create function public.create_seller_payout(p_order_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_payout_id uuid;
  v_seller_type seller_type;
  v_seller_profile_id uuid;
  v_business_id uuid;
  v_total_cents bigint;
  v_found_count integer;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'At least one order is required';
  end if;

  perform 1 from public.orders where id = any(p_order_ids) for update;

  select count(*) into v_found_count from public.orders where id = any(p_order_ids);
  if v_found_count <> array_length(p_order_ids, 1) then
    raise exception 'One or more orders were not found';
  end if;

  if exists (select 1 from public.orders where id = any(p_order_ids) and payment_method <> 'online') then
    raise exception 'Only online orders are eligible for payout — a cash order''s seller already collected payment directly';
  end if;

  if exists (select 1 from public.orders where id = any(p_order_ids) and status <> 'completed') then
    raise exception 'Every order must be completed before it is eligible for payout';
  end if;

  if (select count(distinct seller_type) from public.orders where id = any(p_order_ids)) > 1
    or (select count(distinct coalesce(seller_profile_id, business_id)) from public.orders where id = any(p_order_ids)) > 1
  then
    raise exception 'All orders in a single payout must belong to the same seller';
  end if;

  if exists (select 1 from public.payout_items where order_id = any(p_order_ids)) then
    raise exception 'One or more orders have already been paid out';
  end if;

  select seller_type, seller_profile_id, business_id
  into v_seller_type, v_seller_profile_id, v_business_id
  from public.orders where id = p_order_ids[1];

  -- Seller net earnings, never the delivery fee — subtotal_cents minus
  -- commission_amount_cents is exactly what OrderDetailView.tsx already
  -- shows the seller as "You receive" (see src/components/orders/OrderDetailView.tsx,
  -- fixed in Phase 7A to use subtotal, not total, for precisely this
  -- reason: the delivery fee is the courier's/Bambini's margin, never
  -- the seller's).
  select coalesce(sum(subtotal_cents - commission_amount_cents), 0) into v_total_cents
  from public.orders where id = any(p_order_ids);

  insert into public.payouts (recipient_type, recipient_profile_id, recipient_business_id, amount_cents, status, period_start, period_end)
  values (v_seller_type, v_seller_profile_id, v_business_id, v_total_cents, 'pending', now(), now())
  returning id into v_payout_id;

  insert into public.payout_items (payout_id, order_id, amount_cents)
  select v_payout_id, o.id, o.subtotal_cents - o.commission_amount_cents
  from public.orders o where o.id = any(p_order_ids);

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (
    v_admin_id, 'payout.created', 'payout', v_payout_id,
    format('%s order(s), total %s cents', array_length(p_order_ids, 1), v_total_cents)
  );

  return v_payout_id;
end;
$$;

revoke execute on function public.create_seller_payout(uuid[]) from public, anon;
grant execute on function public.create_seller_payout(uuid[]) to authenticated;

-- 3. mark_payout_paid() / mark_payout_failed(): admin-only, state-guarded --
-- Both re-check the payout's current status before transitioning it
-- (idempotent-safe: a repeat call on an already-'paid' payout is
-- rejected, never silently re-applied) and record an admin_actions row
-- — the audit trail this phase's brief requires for any manual
-- settlement action.
create function public.mark_payout_paid(p_payout_id uuid, p_provider_reference text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_status payout_status;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  select status into v_status from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout not found';
  end if;
  if v_status = 'paid' then
    raise exception 'This payout has already been marked as paid';
  end if;
  if v_status = 'failed' then
    raise exception 'A failed payout cannot be marked as paid directly';
  end if;

  update public.payouts
  set status = 'paid', paid_at = now(), provider_reference = coalesce(p_provider_reference, provider_reference)
  where id = p_payout_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'payout.marked_paid', 'payout', p_payout_id, p_provider_reference);
end;
$$;

revoke execute on function public.mark_payout_paid(uuid, text) from public, anon;
grant execute on function public.mark_payout_paid(uuid, text) to authenticated;

create function public.mark_payout_failed(p_payout_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_status payout_status;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  select status into v_status from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout not found';
  end if;
  if v_status = 'paid' then
    raise exception 'A paid payout cannot be marked as failed';
  end if;

  update public.payouts set status = 'failed' where id = p_payout_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'payout.marked_failed', 'payout', p_payout_id, p_notes);
end;
$$;

revoke execute on function public.mark_payout_failed(uuid, text) from public, anon;
grant execute on function public.mark_payout_failed(uuid, text) to authenticated;
