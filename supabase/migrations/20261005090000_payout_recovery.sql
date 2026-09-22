-- Phase 8B: payout recovery & settlement operations.
--
-- Phase 8A deliberately left a failed payout's payout_items rows
-- permanently claimed — automatically releasing them could double-pay a
-- seller in the real world if the external transfer actually succeeded
-- through a channel Bambini can't observe. This migration adds the
-- explicit, admin-only recovery path that was always the intended next
-- step, never an automatic one.
--
-- Core schema decision, made carefully (this is the critical point the
-- phase brief itself flags): the double-payout guarantee was a plain
-- UNIQUE(order_id) on payout_items. That constraint is exactly what
-- makes "recover a failed payout, then create a new one for the same
-- order" impossible without a schema change — a plain UNIQUE can't
-- distinguish "this order's payout_items row is the currently-claimed
-- one" from "this order's payout_items row is a superseded historical
-- record". The fix is NOT to delete the old row (the brief is explicit:
-- financial history must never be deleted) and NOT to add a new
-- redundant status table — it's to add one nullable timestamp
-- (superseded_at) and replace the plain UNIQUE with a PARTIAL unique
-- index scoped to "not yet superseded" rows. This is the smallest
-- change that lets an order have at most one ACTIVE claim at a time
-- while every historical claim (however many recoveries have happened)
-- remains permanently in the table, exactly as inserted.
--
-- payout_status gains 'recovered' (via ALTER TYPE ... ADD VALUE) rather
-- than a parallel boolean+timestamp status system living outside the
-- enum — payouts.status is already the single place this codebase looks
-- to answer "what happened to this payout", and recovered is a real,
-- distinct outcome, not a flag on top of 'failed'. The *details* of a
-- recovery (who, when, why) still get their own plain columns on
-- payouts, the same way paid_at/provider_reference already sit
-- alongside status = 'paid' — status answers "what", the columns answer
-- "who/when/why".
--
-- The new enum value is only ever referenced inside a function body
-- below (recover_failed_payout()), never in a bare top-level
-- INSERT/UPDATE in this same migration — plpgsql function bodies are
-- only parsed loosely at CREATE time and the enum literal is resolved
-- when the function actually runs, by which point ADD VALUE has already
-- committed, avoiding Postgres's "unsafe use of new value" restriction
-- entirely.

alter type public.payout_status add value 'recovered';

-- 1. Recovery detail columns on payouts -----------------------------------
alter table public.payouts
  add column recovered_by uuid references public.profiles (id) on delete set null,
  add column recovered_at timestamptz,
  add column recovery_reason text;

-- 2. Supersede marker on payout_items, replacing the plain UNIQUE --------
alter table public.payout_items
  add column superseded_at timestamptz;

alter table public.payout_items drop constraint payout_items_order_id_unique;

-- At most one ACTIVE (not-yet-superseded) payout_items row per order,
-- ever — this is still the irreducible double-payout guarantee Phase 8A
-- established, just scoped correctly now that a recovered order can
-- legitimately have more than one HISTORICAL row.
create unique index payout_items_order_id_active_unique
  on public.payout_items (order_id)
  where superseded_at is null;

-- 3. recover_failed_payout(): admin-only, atomic --------------------------
-- Locks the payout row first (`for update`), then its payout_items rows
-- — a second, concurrent recovery attempt on the SAME payout blocks
-- here until this transaction commits or rolls back, so its own status
-- check afterwards always sees accurate, committed state (status will
-- already be 'recovered', not 'failed', and is rejected cleanly) rather
-- than racing against it. This is the exact same lock-then-recheck
-- shape every other concurrency-sensitive function in this schema
-- already uses (create_seller_payout(), reserve_delivery_order(), ...).
create function public.recover_failed_payout(p_payout_id uuid, p_reason text)
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

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A recovery reason is required';
  end if;

  select status into v_status from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout not found';
  end if;

  if v_status = 'recovered' then
    raise exception 'This payout has already been recovered';
  end if;
  if v_status <> 'failed' then
    raise exception 'Only a failed payout can be recovered';
  end if;

  perform 1 from public.payout_items where payout_id = p_payout_id for update;

  update public.payout_items
  set superseded_at = now()
  where payout_id = p_payout_id and superseded_at is null;

  update public.payouts
  set status = 'recovered', recovered_by = v_admin_id, recovered_at = now(), recovery_reason = p_reason
  where id = p_payout_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'payout.recovered', 'payout', p_payout_id, p_reason);
end;
$$;

revoke execute on function public.recover_failed_payout(uuid, text) from public, anon;
grant execute on function public.recover_failed_payout(uuid, text) to authenticated;

-- 4. create_seller_payout(): CREATE OR REPLACE, same signature -----------
-- Body-only change — its "already paid out" check now only looks at
-- ACTIVE payout_items rows (superseded_at is null), so an order whose
-- only claim was superseded by recover_failed_payout() correctly
-- becomes eligible for a brand-new payout. Every other check
-- (ownership, ordering, existence, same-seller, online-only,
-- completed-only) is completely unchanged.
create or replace function public.create_seller_payout(p_order_ids uuid[])
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

  if exists (select 1 from public.payout_items where order_id = any(p_order_ids) and superseded_at is null) then
    raise exception 'One or more orders have already been paid out';
  end if;

  select seller_type, seller_profile_id, business_id
  into v_seller_type, v_seller_profile_id, v_business_id
  from public.orders where id = p_order_ids[1];

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

-- 5. mark_payout_paid() / mark_payout_failed(): CREATE OR REPLACE --------
-- Both now also reject a 'recovered' payout explicitly (a closed
-- historical record — any further money movement belongs to a new
-- payout, never a mutation of this one), with the same
-- specific-per-current-status error style already established.
create or replace function public.mark_payout_paid(p_payout_id uuid, p_provider_reference text default null)
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
  if v_status = 'recovered' then
    raise exception 'A recovered payout cannot be marked as paid — create a new payout instead';
  end if;

  update public.payouts
  set status = 'paid', paid_at = now(), provider_reference = coalesce(p_provider_reference, provider_reference)
  where id = p_payout_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'payout.marked_paid', 'payout', p_payout_id, p_provider_reference);
end;
$$;

create or replace function public.mark_payout_failed(p_payout_id uuid, p_notes text default null)
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
  if v_status = 'failed' then
    raise exception 'This payout has already been marked as failed';
  end if;
  if v_status = 'recovered' then
    raise exception 'A recovered payout cannot be marked as failed';
  end if;

  update public.payouts set status = 'failed' where id = p_payout_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'payout.marked_failed', 'payout', p_payout_id, p_notes);
end;
$$;
