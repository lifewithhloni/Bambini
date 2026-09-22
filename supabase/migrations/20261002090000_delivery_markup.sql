-- Phase 7C: server-authoritative delivery markup.
--
-- Bambini's delivery fee to the buyer is no longer the provider's raw
-- quote — it's provider_cost + an admin-configurable markup. This
-- migration adds the markup setting (an append-only history, exactly
-- like commission_rates, for the same reason: an existing order must
-- keep the rate that was actually in effect when its quote was fetched,
-- never be recalculated against whatever the admin has since changed the
-- global rate to) and extends both delivery_quotes and orders to
-- preserve the full breakdown (provider cost / markup percentage /
-- markup amount / buyer-facing fee) rather than collapsing it into a
-- single number, so a future reconciliation can always answer "how much
-- did the provider actually cost us on this order" independently of
-- "how much did the buyer pay for delivery".
--
-- Markup calculation itself happens in application code
-- (src/server/delivery/quoteService.ts, at quote-fetch time — the same
-- place provider_id/price_cents/expires_at etc. are already resolved and
-- persisted), not in create_order(). create_order() only ever snapshots
-- the already-computed, already-quote-locked values from the
-- server-persisted delivery_quotes row onto the order — exactly the same
-- trust model this schema already uses for price_cents/service_level/
-- provider_id: the client never had a way to set those either, and the
-- same protection extends automatically to the three new columns because
-- they're written the identical way (service-role insert, never a client
-- write path).

-- 1. Delivery markup setting -------------------------------------------
-- Append-only, mirroring commission_rates exactly: "current" = the
-- latest row, a change is a new row, never an UPDATE of an existing one
-- — this is what makes "order A keeps its original 10% after the admin
-- changes the global rate to 20%" true by construction, not by a
-- special case in create_order().
create table public.delivery_markup_settings (
  id uuid primary key default gen_random_uuid(),
  -- 10000 bps (100%) is a hard technical ceiling, not a business
  -- decision about what markup is reasonable — it exists only to catch
  -- an obviously-wrong input (e.g. a misplaced decimal point), the same
  -- role the identical bound already plays on commission_rates.rate_bps.
  markup_percentage_bps integer not null check (markup_percentage_bps between 0 and 10000),
  changed_by uuid references public.profiles (id) on delete set null,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index delivery_markup_settings_effective_from_idx on public.delivery_markup_settings (effective_from desc);

-- Sensible default: 0% — a technical baseline ("delivery costs exactly
-- what the provider charges until an admin deliberately changes it"),
-- not a claim about what markup the business should actually charge.
-- Seeded directly here (unlike commission_rates, seeded in seed.sql)
-- because a missing row here would leave quoteService.ts with no rate
-- to read at all in a real deployment where seed.sql never runs —
-- cash_settings' own singleton row is seeded the identical way, in its
-- own migration, for the same reason.
insert into public.delivery_markup_settings (markup_percentage_bps) values (0);

alter table public.delivery_markup_settings enable row level security;
-- Admin-only SELECT — mirrors commission_rates_select_admin exactly.
-- quoteService.ts reads the current rate via the service-role client
-- (bypasses RLS entirely, same as every other admin-only config table
-- this codebase already reads that way), never through a buyer's own
-- session.
create policy delivery_markup_settings_select_admin on public.delivery_markup_settings
  for select using (public.is_admin());

-- update_delivery_markup_setting(): the only sanctioned write path.
-- Admin-only (checked internally via is_admin(), the same "granted
-- broadly to authenticated, is_admin() checked inside" pattern
-- review_identity_verification() already uses — there's no separate
-- Postgres role for "admin" in this schema). Always inserts a NEW row
-- (append-only — see the table's own comment); changed_by always comes
-- from auth.uid(), never a parameter, so the audit trail can't be
-- spoofed.
create function public.update_delivery_markup_setting(p_markup_percentage_bps integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  if p_markup_percentage_bps is null or p_markup_percentage_bps < 0 or p_markup_percentage_bps > 10000 then
    raise exception 'Markup percentage must be between 0%% and 100%%';
  end if;

  insert into public.delivery_markup_settings (markup_percentage_bps, changed_by)
  values (p_markup_percentage_bps, v_admin_id);
end;
$$;

revoke execute on function public.update_delivery_markup_setting(integer) from public, anon;
grant execute on function public.update_delivery_markup_setting(integer) to authenticated;

-- 2. delivery_quotes: preserve the full breakdown, not just the
--    buyer-facing price ----------------------------------------------
-- price_cents' own meaning is unchanged (it's always been "what the
-- buyer is quoted/charged") — these three columns are what's genuinely
-- new: the provider's own raw cost, the rate applied, and the resulting
-- markup amount, all snapshotted once at quote-fetch time and never
-- recalculated later.
--
-- Added nullable first, backfilled, then constrained NOT NULL — the
-- safe migration shape for a table that may already have rows (Phase
-- 7A shipped in a prior migration; this doesn't assume the table is
-- empty). Every pre-existing quote predates markup entirely, so its
-- price_cents WAS the provider cost at the time — backfilling
-- provider_cost_cents = price_cents and markup = 0 is not a guess, it's
-- the historically accurate value for a row created before this feature
-- existed.
alter table public.delivery_quotes
  add column provider_cost_cents bigint,
  add column markup_percentage_bps integer,
  add column markup_amount_cents bigint;

update public.delivery_quotes
set provider_cost_cents = price_cents, markup_percentage_bps = 0, markup_amount_cents = 0
where provider_cost_cents is null;

alter table public.delivery_quotes
  alter column provider_cost_cents set not null,
  alter column markup_percentage_bps set not null,
  alter column markup_amount_cents set not null,
  add constraint delivery_quotes_provider_cost_cents_check check (provider_cost_cents >= 0),
  add constraint delivery_quotes_markup_percentage_bps_check check (markup_percentage_bps between 0 and 10000),
  add constraint delivery_quotes_markup_amount_cents_check check (markup_amount_cents >= 0),
  -- Defense in depth: the buyer-facing price can never silently drift
  -- from provider cost + markup, whatever inserted the row.
  add constraint delivery_quotes_price_matches_markup check (price_cents = provider_cost_cents + markup_amount_cents);

-- 3. orders: the same breakdown, snapshotted onto the order itself -----
-- delivery_fee_cents' own meaning is unchanged (the buyer-facing fee,
-- already what total_cents is built from) — these three are the new
-- reconciliation data: what the provider actually cost Bambini on this
-- specific order, the rate that produced the markup, and the resulting
-- margin. Not merely derivable from delivery_quotes (whose lifecycle is
-- more transient/checkout-scoped) — the order is the durable financial
-- record, so it gets its own snapshot, the same reasoning
-- commission_rate_bps/commission_amount_cents already followed here.
--
-- Buyer-visible at the RLS layer exactly like commission_rate_bps/
-- commission_amount_cents already are on this same table (see
-- orders_select_participant_or_admin — row-level only, no column
-- restriction) — this codebase's own established convention for this
-- category of internal-but-not-catastrophic financial detail is "hide
-- it in the UI, not the database" (see DATABASE.md/the Phase 4A order
-- detail view, which already renders commission only for
-- viewerRole==='seller' despite the buyer's own session being able to
-- read the same row). No new mechanism is introduced here that doesn't
-- already exist for a field of the same sensitivity class on this exact
-- table.
alter table public.orders
  add column provider_delivery_cost_cents bigint,
  add column delivery_markup_percentage_bps integer,
  add column delivery_markup_amount_cents bigint;

update public.orders
set provider_delivery_cost_cents = delivery_fee_cents, delivery_markup_percentage_bps = 0, delivery_markup_amount_cents = 0
where provider_delivery_cost_cents is null;

alter table public.orders
  alter column provider_delivery_cost_cents set not null,
  alter column provider_delivery_cost_cents set default 0,
  alter column delivery_markup_percentage_bps set not null,
  alter column delivery_markup_percentage_bps set default 0,
  alter column delivery_markup_amount_cents set not null,
  alter column delivery_markup_amount_cents set default 0,
  add constraint orders_provider_delivery_cost_cents_check check (provider_delivery_cost_cents >= 0),
  add constraint orders_delivery_markup_percentage_bps_check check (delivery_markup_percentage_bps between 0 and 10000),
  add constraint orders_delivery_markup_amount_cents_check check (delivery_markup_amount_cents >= 0),
  add constraint orders_delivery_fee_matches_markup check (delivery_fee_cents = provider_delivery_cost_cents + delivery_markup_amount_cents);

-- 4. create_order(): snapshot the quote's breakdown onto the order -----
-- CREATE OR REPLACE, same signature — this is a body-only change (no
-- parameter added/removed), unlike the DROP+CREATE Phase 7A/7B needed
-- when p_delivery_quote_id itself was added.
--
-- Every existing check (ownership, expiry, product/pickup/dropoff
-- match, provider active) is completely unchanged — the only addition
-- is reading three more columns off the SAME already-validated
-- v_quote row (select * already returns them) and writing them onto
-- the order. For collection (no quote), all three stay at their column
-- defaults (0), matching delivery_fee_cents' own existing default-0
-- behavior for collection.
create or replace function public.create_order(
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
  v_provider_delivery_cost_cents bigint := 0;
  v_delivery_markup_percentage_bps integer := 0;
  v_delivery_markup_amount_cents bigint := 0;
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

    -- The buyer-facing fee, and the reconciliation breakdown behind it,
    -- both come from this same already-validated, server-persisted
    -- quote row — never a client-supplied value, and never recomputed
    -- against whatever the admin markup setting happens to be right now.
    v_delivery_fee_cents := v_quote.price_cents;
    v_provider_delivery_cost_cents := v_quote.provider_cost_cents;
    v_delivery_markup_percentage_bps := v_quote.markup_percentage_bps;
    v_delivery_markup_amount_cents := v_quote.markup_amount_cents;
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
    subtotal_cents, delivery_fee_cents, provider_delivery_cost_cents, delivery_markup_percentage_bps,
    delivery_markup_amount_cents, total_cents, commission_rate_bps, commission_amount_cents,
    currency, delivery_location_id
  ) values (
    v_buyer_id, v_seller_type, v_seller_profile_id, v_business_id, p_fulfilment_type, p_payment_method, 'pending_payment',
    v_price_cents, v_delivery_fee_cents, v_provider_delivery_cost_cents, v_delivery_markup_percentage_bps,
    v_delivery_markup_amount_cents, v_total_cents, v_rate_bps, v_commission_cents,
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
      'provider_delivery_cost_cents', v_provider_delivery_cost_cents,
      'delivery_markup_percentage_bps', v_delivery_markup_percentage_bps,
      'delivery_markup_amount_cents', v_delivery_markup_amount_cents,
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
