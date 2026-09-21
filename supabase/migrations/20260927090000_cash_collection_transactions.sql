-- Phase 4C: collection + cash transactions.
--
-- Everything this migration needs already existed, unused, since the
-- foundation phase: collection_confirmations, seller_cash_status,
-- cash_eligibility_criteria (all seeded/RLS'd in
-- 20260920090800_cash_collection.sql / 20260920091500_rls_policies.sql),
-- payment_method already had 'cash', and
-- src/server/cash-eligibility/evaluateCashEligibility.ts already encoded
-- every eligibility rule. This migration wires that scaffolding into the
-- live transaction flow rather than inventing a new one. What's actually
-- new:
--
-- 1. commission_settlement_status — commissions did not previously track
--    whether Bambini has actually received its cut. For an online order
--    the commission is implicitly already in Bambini's possession (it
--    holds 100% of the payment via PayFast) — 'collected_via_payment'.
--    For a cash order the seller keeps 100% of the cash directly, so the
--    commission is money the seller now owes Bambini, not money Bambini
--    has — 'owed_by_seller'. 'settled' is reserved for a future
--    financial-settlement phase; nothing in this migration ever writes
--    it to mean "collected" (see the CRITICAL note in the architecture
--    brief) — the one place it's used here is decline_cash_order(),
--    where the order never completed and no obligation was ever really
--    incurred; 'settled' ("nothing outstanding") is the closest of the
--    three fixed values to that truth without falsely claiming Bambini
--    received cash it never did.
-- 2. cash_settings — a global kill-switch. A tiny singleton table (the
--    `id boolean primary key default true` trick forces exactly one
--    row) rather than repurposing cash_eligibility_criteria, which is
--    about tuning the bar for an individual seller, not gating cash
--    platform-wide — those are different concerns and conflating them
--    would complicate evaluate_cash_eligibility() for no reason.
-- 3. collection_confirmations.failed_attempts — brute-force protection
--    for the collection code (max 5 failed attempts, then locked).
-- 4. A column-level SELECT fix on collection_confirmations. The existing
--    RLS policy (collection_confirmations_select_participant_or_admin)
--    is row-level only — it does not stop the *seller* from reading
--    collection_code directly, which would let a dishonest seller look
--    up the code themselves and self-confirm without the buyer ever
--    being involved, defeating the entire trust model this table's own
--    original comment describes. RLS decides which *rows* are visible;
--    this is a column-level REVOKE/GRANT, the same mechanism already
--    used on profiles/businesses INSERT (see
--    20260920100000_restrict_insert_columns.sql), applied to SELECT.
--    collection_code becomes reachable only through
--    get_my_collection_code() (buyer-only) or a service-role session —
--    never a plain authenticated SELECT, buyer or seller.
-- 5. Six new/changed functions: create_order() gains a p_payment_method
--    parameter (default 'online', so every existing caller is
--    untouched); evaluate_cash_eligibility()/record_seller_cash_status()
--    are internal SQL mirrors of evaluateCashEligibility.ts, used by
--    create_order()/accept_cash_order() and never granted to
--    authenticated directly (the same "never trust an out-of-process
--    value inside a single atomic transaction" reasoning create_order()
--    already used for calculateCommission()); is_seller_cash_eligible()
--    is the public-safe boolean-only wrapper the checkout UI calls;
--    accept_cash_order()/decline_cash_order()/confirm_collection()/
--    get_my_collection_code() are new SECURITY DEFINER functions
--    following the exact pattern create_order()/record_payment_attempt()
--    already established (no INSERT/UPDATE policy exists for
--    `authenticated` on any of these tables — see the RLS migration's
--    own header comment — so a normal user has no other path to make
--    these writes; every check that matters is re-derived from
--    auth.uid() inside the function body, never trusted from a
--    parameter).

-- 1. Commission settlement status --------------------------------------
create type commission_settlement_status as enum ('collected_via_payment', 'owed_by_seller', 'settled');

alter table public.commissions
  add column settlement_status commission_settlement_status not null default 'collected_via_payment';

-- 2. Global cash kill-switch ---------------------------------------------
-- Singleton table: `id boolean primary key default true` plus a check
-- that id = true means exactly one row can ever exist. Readable by
-- anyone (mirrors payment_providers_select_active — a non-secret boolean
-- flag the checkout UI needs to decide whether to even offer cash);
-- writable only by service_role/direct migration for now — no admin UI
-- ships this phase, so there is deliberately no UPDATE grant for
-- `authenticated` yet (see DECISIONS.md).
create table public.cash_settings (
  id boolean primary key default true,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint cash_settings_singleton check (id)
);

insert into public.cash_settings (id, is_enabled) values (true, true);

create trigger set_updated_at before update on public.cash_settings
  for each row execute function public.set_updated_at();

alter table public.cash_settings enable row level security;
create policy cash_settings_select_all on public.cash_settings
  for select using (true);

-- 3. Collection code brute-force protection -----------------------------
alter table public.collection_confirmations
  add column failed_attempts integer not null default 0
  constraint collection_confirmations_failed_attempts_range check (failed_attempts between 0 and 5);

-- 4. Collection code privacy fix -----------------------------------------
-- Every column except collection_code remains visible to both
-- participants (outcome metadata, not the secret). anon gets nothing
-- regardless (no row ever matches its RLS predicate), but the REVOKE is
-- scoped to `authenticated` specifically so admins acting through a
-- trusted service-role session (not built this phase; a future
-- dispute-resolution tool) are unaffected.
revoke select on public.collection_confirmations from authenticated;
grant select (
  id, order_id, code_generated_at, confirmed_by, confirmed_at, buyer_present, notes, created_at, failed_attempts
) on public.collection_confirmations to authenticated;

-- 5. Cash + delivery is impossible at the schema level too --------------
-- Defense in depth beyond create_order()'s own runtime check — even a
-- hypothetical future direct write cannot create this combination.
alter table public.orders
  add constraint orders_cash_requires_collection check (
    payment_method <> 'cash' or fulfilment_type = 'collection'
  );

-- 6. Fresh eligibility evaluation (internal — mirrors evaluateCashEligibility.ts) ----
-- Pure/stable: reads standing + active criteria, never writes anything.
-- SECURITY DEFINER because it reads profiles/businesses/disputes columns
-- the calling role may not otherwise have row access to for a seller
-- that isn't them (e.g. a buyer's checkout-time eligibility check).
-- Business sellers have no separate "identity_verification" concept
-- (only one KYC-style verification_status on the businesses row) — both
-- isAccountVerified and isIdentityVerified map to that same column for a
-- business seller, a deliberate, documented simplification rather than
-- inventing a second verification concept businesses don't have.
create function public.evaluate_cash_eligibility(
  p_seller_type seller_type,
  p_seller_profile_id uuid,
  p_business_id uuid
)
returns table (eligible boolean, failed_criteria text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_verified boolean;
  v_identity_verified boolean;
  v_completed_transactions integer;
  v_rating numeric;
  v_account_standing account_standing;
  v_unresolved_disputes integer := 0;
  v_failed text[] := '{}';
  v_found boolean := false;
  v_criterion record;
begin
  if p_seller_type = 'parent' then
    select (account_verification = 'verified'), (identity_verification = 'verified'),
      completed_transaction_count, rating_average, account_standing, true
    into v_account_verified, v_identity_verified, v_completed_transactions, v_rating, v_account_standing, v_found
    from public.profiles where id = p_seller_profile_id;

    select count(*) into v_unresolved_disputes
    from public.disputes d
    join public.orders o on o.id = d.order_id
    where o.seller_profile_id = p_seller_profile_id and d.status in ('open', 'under_review');
  else
    select (verification_status = 'verified'), (verification_status = 'verified'),
      completed_transaction_count, rating_average, account_standing, true
    into v_account_verified, v_identity_verified, v_completed_transactions, v_rating, v_account_standing, v_found
    from public.businesses where id = p_business_id;

    select count(*) into v_unresolved_disputes
    from public.disputes d
    join public.orders o on o.id = d.order_id
    where o.business_id = p_business_id and d.status in ('open', 'under_review');
  end if;

  if not v_found then
    return query select false, array['seller_not_found']::text[];
    return;
  end if;

  -- Matches evaluateCashEligibility()'s own short-circuit: account
  -- standing is checked first and, if not 'good', is the only reported
  -- failure regardless of anything else.
  if v_account_standing <> 'good' then
    return query select false, array['account_standing']::text[];
    return;
  end if;

  for v_criterion in select key, threshold from public.cash_eligibility_criteria where is_active loop
    case v_criterion.key
      when 'min_completed_transactions' then
        if v_completed_transactions < (v_criterion.threshold::text)::integer then
          v_failed := array_append(v_failed, v_criterion.key);
        end if;
      when 'min_rating_average' then
        if coalesce(v_rating, 0) < (v_criterion.threshold::text)::numeric then
          v_failed := array_append(v_failed, v_criterion.key);
        end if;
      when 'requires_account_verification' then
        if (v_criterion.threshold::text)::boolean and not v_account_verified then
          v_failed := array_append(v_failed, v_criterion.key);
        end if;
      when 'requires_identity_verification' then
        if (v_criterion.threshold::text)::boolean and not v_identity_verified then
          v_failed := array_append(v_failed, v_criterion.key);
        end if;
      when 'max_unresolved_disputes' then
        if v_unresolved_disputes > (v_criterion.threshold::text)::integer then
          v_failed := array_append(v_failed, v_criterion.key);
        end if;
      else
        null;
    end case;
  end loop;

  return query select (array_length(v_failed, 1) is null), v_failed;
end;
$$;

revoke execute on function public.evaluate_cash_eligibility(seller_type, uuid, uuid) from public, anon, authenticated;

-- Audit/visibility snapshot only — see the header comment. Never the
-- authoritative gate; create_order()/accept_cash_order() always call
-- evaluate_cash_eligibility() fresh and decide from that, then log the
-- result here purely so an admin can later see "why."
create function public.record_seller_cash_status(
  p_seller_type seller_type,
  p_seller_profile_id uuid,
  p_business_id uuid,
  p_eligible boolean,
  p_failed_criteria text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_seller_type = 'parent' then
    insert into public.seller_cash_status (seller_type, seller_profile_id, business_id, is_eligible, failed_criteria, evaluated_at)
    values ('parent', p_seller_profile_id, null, p_eligible, p_failed_criteria, now())
    on conflict (seller_profile_id) where seller_profile_id is not null
    do update set is_eligible = excluded.is_eligible, failed_criteria = excluded.failed_criteria, evaluated_at = excluded.evaluated_at;
  else
    insert into public.seller_cash_status (seller_type, seller_profile_id, business_id, is_eligible, failed_criteria, evaluated_at)
    values ('business', null, p_business_id, p_eligible, p_failed_criteria, now())
    on conflict (business_id) where business_id is not null
    do update set is_eligible = excluded.is_eligible, failed_criteria = excluded.failed_criteria, evaluated_at = excluded.evaluated_at;
  end if;
end;
$$;

revoke execute on function public.record_seller_cash_status(seller_type, uuid, uuid, boolean, text[]) from public, anon, authenticated;

-- Public-safe wrapper: the checkout UI's "should I show Cash on
-- collection" check. Deliberately returns only a boolean — never
-- failed_criteria, which would tell a buyer exactly why a seller falls
-- short (e.g. "unresolved dispute"), information that belongs to the
-- seller/admin, not a browsing buyer.
create function public.is_seller_cash_eligible(
  p_seller_type seller_type,
  p_seller_profile_id uuid,
  p_business_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select eligible from public.evaluate_cash_eligibility(p_seller_type, p_seller_profile_id, p_business_id)), false);
$$;

revoke execute on function public.is_seller_cash_eligible(seller_type, uuid, uuid) from public, anon;
grant execute on function public.is_seller_cash_eligible(seller_type, uuid, uuid) to authenticated;

-- 7. create_order(), extended with p_payment_method ----------------------
-- Signature change (a new parameter, even with a default, is a distinct
-- overload to Postgres) — DROP + CREATE, the same convention already
-- used when nearby-search's return columns changed, not CREATE OR
-- REPLACE (which only covers same-signature body edits, as Phase 4B's
-- provider-lookup fix was). The default of 'online' means every existing
-- 2-argument caller (src/server/orders/actions.ts, tests/db/orders.test.ts)
-- is completely unaffected.
drop function public.create_order(uuid, fulfilment_type);

create function public.create_order(
  p_product_id uuid,
  p_fulfilment_type fulfilment_type,
  p_payment_method payment_method default 'online'
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
  v_settlement_status commission_settlement_status;
  v_cash_enabled boolean;
  v_eligible boolean;
  v_failed_criteria text[];
  v_collection_code text;
  v_rand_bytes bytea;
  v_attempts integer := 0;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  -- Checked before touching the product at all: this is purely a
  -- function of the caller's own two parameters, so failing fast here
  -- avoids ever flipping a product to 'sold' for a request that can
  -- never legitimately succeed.
  if p_payment_method = 'cash' and p_fulfilment_type = 'delivery' then
    raise exception 'Cash on collection is not available for delivery orders';
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

  if p_payment_method = 'online' then
    select id into v_provider_id from public.payment_providers where is_active limit 1;
    if v_provider_id is null then
      raise exception 'Payment processing is not currently available';
    end if;
    v_settlement_status := 'collected_via_payment';
  else
    -- Cash: global switch, then a fresh (never cached/trusted)
    -- eligibility evaluation — see evaluate_cash_eligibility() above.
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
    v_price_cents, 0, v_price_cents, v_rate_bps, v_commission_cents,
    v_currency, v_delivery_location_id
  )
  returning id, orders.order_reference into v_order_id, v_order_reference;

  insert into public.order_items (order_id, product_id, title_snapshot, price_cents_snapshot, quantity)
  values (v_order_id, p_product_id, v_title, v_price_cents, 1);

  insert into public.payments (order_id, provider_id, method, status, amount_cents, currency)
  values (v_order_id, v_provider_id, p_payment_method, 'pending', v_price_cents, v_currency);

  insert into public.commissions (order_id, seller_type, rate_bps, base_amount_cents, commission_amount_cents, settlement_status)
  values (v_order_id, v_seller_type, v_rate_bps, v_price_cents, v_commission_cents, v_settlement_status);

  -- Every collection order (cash or online-paid) gets a collection
  -- record + code up front, in the same atomic transaction as the order
  -- itself — matches collection_confirmations' own original design
  -- comment ("created whenever fulfilment_type = 'collection'"). Code is
  -- 6 numeric digits from pgcrypto's gen_random_bytes (cryptographically
  -- secure, same primitive order_reference already uses), never derived
  -- from any id/timestamp/sequence.
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
      'commission_rate_bps', v_rate_bps,
      'commission_amount_cents', v_commission_cents
    )
  );

  if p_payment_method = 'cash' then
    insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
    values (
      v_order_id, 'order', v_order_id, 'cash.order_created', 'buyer', v_buyer_id,
      jsonb_build_object('commission_amount_cents', v_commission_cents)
    );
  end if;

  return query select v_order_id, v_order_reference;
end;
$$;

revoke execute on function public.create_order(uuid, fulfilment_type, payment_method) from public;
revoke execute on function public.create_order(uuid, fulfilment_type, payment_method) from anon;
grant execute on function public.create_order(uuid, fulfilment_type, payment_method) to authenticated;

-- 8. Seller accepts a pending cash order ----------------------------------
-- pending_payment -> confirmed. Payment stays cash/pending — Bambini has
-- not received anything yet; 'confirmed' here means "this sale is going
-- ahead," the same value process_payfast_itn() already uses to mean
-- "payment succeeded" for an online order. These are deliberately the
-- same order_status value for two different underlying reasons —
-- payments.status is the separate, authoritative signal for whether
-- money has actually moved (see ARCHITECTURE.md).
create function public.accept_cash_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order record;
  v_cash_enabled boolean;
  v_eligible boolean;
  v_failed_criteria text[];
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  select o.id, o.status, o.seller_type, o.seller_profile_id, o.business_id
  into v_order
  from public.orders o
  join public.payments p on p.order_id = o.id
  where o.id = p_order_id
    and p.method = 'cash'
    and (o.seller_profile_id = v_seller_id or public.is_business_member(o.business_id))
  for update of o;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'Order is not awaiting acceptance';
  end if;

  select is_enabled into v_cash_enabled from public.cash_settings where id;
  if not coalesce(v_cash_enabled, false) then
    raise exception 'Cash payments are currently unavailable';
  end if;

  select eligible, failed_criteria into v_eligible, v_failed_criteria
  from public.evaluate_cash_eligibility(v_order.seller_type, v_order.seller_profile_id, v_order.business_id);

  perform public.record_seller_cash_status(v_order.seller_type, v_order.seller_profile_id, v_order.business_id, v_eligible, v_failed_criteria);

  if not v_eligible then
    raise exception 'You are no longer eligible to accept cash orders';
  end if;

  update public.orders set status = 'confirmed' where id = p_order_id;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id)
  values (p_order_id, 'order', p_order_id, 'cash_order.accepted', 'seller', v_seller_id);
end;
$$;

revoke execute on function public.accept_cash_order(uuid) from public, anon;
grant execute on function public.accept_cash_order(uuid) to authenticated;

-- 9. Seller declines a pending cash order ----------------------------------
-- pending_payment -> cancelled. Unlike a PayFast failure (Phase 4B,
-- deliberately leaves the listing 'sold' — see DECISIONS.md), this is a
-- clean, deliberate, unambiguous seller action with no money having
-- moved, so it's safe to release the listing back to 'published' here
-- specifically — this does NOT change the general PayFast-failure
-- behaviour, which stays exactly as Phase 4B left it.
create function public.decline_cash_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order record;
  v_product_id uuid;
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  select o.id, o.status
  into v_order
  from public.orders o
  join public.payments p on p.order_id = o.id
  where o.id = p_order_id
    and p.method = 'cash'
    and (o.seller_profile_id = v_seller_id or public.is_business_member(o.business_id))
  for update of o;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'Order cannot be declined at this stage';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;

  -- No obligation was ever really incurred for a transaction that never
  -- happened — see the header comment on why 'settled' (not
  -- 'collected_via_payment') is used here.
  update public.commissions set settlement_status = 'settled' where order_id = p_order_id;

  select oi.product_id into v_product_id from public.order_items oi where oi.order_id = p_order_id;
  if v_product_id is not null then
    update public.products set status = 'published' where id = v_product_id and status = 'sold';
  end if;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (p_order_id, 'order', p_order_id, 'cash_order.declined', 'seller', v_seller_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.decline_cash_order(uuid, text) from public, anon;
grant execute on function public.decline_cash_order(uuid, text) to authenticated;

-- 10. Collection confirmation (both cash and online-paid collection) -----
-- Shared by both payment methods rather than two separate functions —
-- the only real difference is whether payments.status also needs to
-- move (cash: pending -> paid, since this is the moment money actually
-- changed hands; online: already 'paid' via process_payfast_itn(),
-- nothing to change). This also closes a real Phase 4B gap: there was
-- previously no path at all from 'confirmed' to 'completed' for an
-- online-paid collection order.
create function public.confirm_collection(p_order_id uuid, p_code text)
returns table (outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order record;
  v_payment record;
  v_confirmation record;
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  select o.id, o.status, o.fulfilment_type
  into v_order
  from public.orders o
  where o.id = p_order_id
    and (o.seller_profile_id = v_seller_id or public.is_business_member(o.business_id))
  for update of o;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.fulfilment_type <> 'collection' then
    raise exception 'This order is not a collection order';
  end if;

  select c.id, c.collection_code, c.failed_attempts
  into v_confirmation
  from public.collection_confirmations c
  where c.order_id = p_order_id
  for update;

  if not found then
    raise exception 'No collection record for this order';
  end if;

  -- Terminal-state protection first, same convention as
  -- process_payfast_itn(): an already-completed order is never
  -- reprocessed, and a repeat/duplicate confirm_collection() call (any
  -- code, right or wrong) is a safe, idempotent no-op from here.
  if v_order.status = 'completed' then
    return query select 'already_completed'::text;
    return;
  end if;

  if v_order.status <> 'confirmed' then
    raise exception 'Order is not ready for collection confirmation';
  end if;

  if v_confirmation.failed_attempts >= 5 then
    return query select 'locked'::text;
    return;
  end if;

  if v_confirmation.collection_code <> p_code then
    update public.collection_confirmations
    set failed_attempts = failed_attempts + 1
    where id = v_confirmation.id;

    insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id)
    values (p_order_id, 'collection_confirmation', v_confirmation.id, 'collection.attempt_failed', 'seller', v_seller_id);

    if v_confirmation.failed_attempts + 1 >= 5 then
      return query select 'locked'::text;
    else
      return query select 'incorrect_code'::text;
    end if;
    return;
  end if;

  update public.collection_confirmations
  set confirmed_by = v_seller_id, confirmed_at = now()
  where id = v_confirmation.id;

  select p.id, p.method into v_payment from public.payments p where p.order_id = p_order_id for update;

  -- Online orders are only ever 'confirmed' via a paid PayFast webhook
  -- (process_payfast_itn()) — payments.status is already 'paid' by
  -- construction, so there is nothing to change for that method here.
  if v_payment.method = 'cash' then
    update public.payments set status = 'paid' where id = v_payment.id;
  end if;

  update public.orders set status = 'completed', completed_at = now() where id = p_order_id;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (
    p_order_id, 'order', p_order_id, 'collection.confirmed', 'seller', v_seller_id,
    jsonb_build_object('payment_method', v_payment.method)
  );

  return query select 'completed'::text;
end;
$$;

revoke execute on function public.confirm_collection(uuid, text) from public, anon;
grant execute on function public.confirm_collection(uuid, text) to authenticated;

-- 11. Buyer-only collection code retrieval ---------------------------------
-- The only sanctioned way to read a raw collection_code (see the
-- column-grant fix above) — mirrors the search_nearby_products()
-- "narrow SECURITY DEFINER function is the sanctioned public-safe
-- surface" pattern established in Phase 3B, applied here to a secret
-- instead of a location.
create function public.get_my_collection_code(p_order_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_code text;
begin
  if v_buyer_id is null then
    raise exception 'Authentication required';
  end if;

  select c.collection_code into v_code
  from public.collection_confirmations c
  join public.orders o on o.id = c.order_id
  where c.order_id = p_order_id and o.buyer_id = v_buyer_id;

  if not found then
    raise exception 'Collection code not found';
  end if;

  return v_code;
end;
$$;

revoke execute on function public.get_my_collection_code(uuid) from public, anon;
grant execute on function public.get_my_collection_code(uuid) to authenticated;
