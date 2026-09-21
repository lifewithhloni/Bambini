-- Phase 5: identity, account verification & transaction access control.
--
-- Two separate concepts, per the product brief:
--
-- ACCOUNT VERIFICATION — confirmed email + confirmed phone. Derived live
-- from Supabase Auth's own auth.users.email_confirmed_at/phone_confirmed_at
-- every time it's checked — never stored, never cached, never
-- client-settable. profiles.account_verification (Phase 0 scaffolding)
-- is retained (never dropped) but is no longer read by anything
-- authorization-relevant as of this migration — it becomes a display-only
-- legacy column. There is no SMS provider configured anywhere in this
-- project (grepped supabase/config.toml — no [auth.sms] section), so
-- phone_confirmed_at will genuinely be NULL for every real signup until
-- one is added; this migration does not invent a fake phone-verification
-- mechanism to work around that (see DECISIONS.md).
--
-- IDENTITY VERIFICATION — a manual-review process: the user submits an SA
-- ID number + document, an admin approves or rejects it. The
-- identity_verifications table (Phase 0 scaffolding) already supports
-- multiple submissions/history correctly (no unique constraint on
-- profile_id, insert-only for the submitter) — nothing about that shape
-- changes. What's new: the ID number itself (never on profiles — stays
-- on this narrowly-RLS'd table), a privacy-preserving hash for duplicate
-- detection, a trigger that keeps profiles.identity_verification synced
-- to "the latest submission's status" (safe to cache, unlike account
-- verification, because it only ever changes via a controlled admin
-- review, not an external Auth event this schema has no hook into), and
-- a SECURITY DEFINER review function replacing the previous raw
-- admin-UPDATE RLS policy (tightening, not weakening — admin writes now
-- go through one auditable, state-machine-safe path).
--
-- can_transact() is the new, single, reusable, non-configurable gate:
-- confirmed email AND confirmed phone AND latest identity status =
-- 'verified'. It is deliberately separate from and layered underneath
-- Phase 4C's own (admin-configurable) cash_eligibility_criteria system —
-- an admin toggling off the `requires_account_verification`/
-- `requires_identity_verification` cash criteria rows must never be able
-- to let an unverified seller transact; that would defeat the whole
-- point of a platform-wide, non-negotiable rule. Phase 4C's own
-- eligibility criteria remain fully intact as an *additional* layer on
-- top, per the brief's explicit "AND" requirement.

-- 1. Identity verification: ID number + privacy-preserving duplicate detection ----
-- No existing row can violate the NOT NULL add (this table has never had
-- real data in any environment this project has run in). id_number_hash
-- is GENERATED — Postgres forbids ever supplying it directly on
-- INSERT/UPDATE, so it can never drift from id_number and never needs a
-- grant of its own. digest() is pgcrypto's, already installed
-- (20260920090000_extensions_and_enums.sql).
alter table public.identity_verifications
  add column id_number text not null check (id_number ~ '^[0-9]{13}$'),
  add column id_number_hash text generated always as (encode(digest(id_number, 'sha256'), 'hex')) stored;

-- Prevents two different profiles from both holding a *verified*
-- submission for the same ID number — deliberately partial (WHERE
-- status = 'verified'), not table-wide, so the same person's own
-- rejected-then-resubmitted history (the same real ID number, submitted
-- more than once) never collides with itself. review_identity_verification()
-- below catches the resulting unique_violation and turns it into a clear
-- error rather than a raw constraint message.
create unique index identity_verifications_verified_id_hash_idx
  on public.identity_verifications (id_number_hash)
  where status = 'verified';

create index identity_verifications_status_idx on public.identity_verifications (status);

revoke insert on public.identity_verifications from authenticated;
grant insert (profile_id, provider, document_type, document_storage_path, id_number)
  on public.identity_verifications to authenticated;

-- Tightening, not weakening: admin review now goes exclusively through
-- review_identity_verification() (below), which is state-machine-safe
-- (only a 'pending' submission can be decided), always records
-- reviewed_by from auth.uid() (never a client-supplied value — the old
-- raw-UPDATE policy had no WITH CHECK constraining that at all), and
-- writes an admin_actions audit row atomically with the decision. This
-- mirrors the established "no direct write policy, SECURITY DEFINER
-- function only" convention orders/payments/commissions already use.
drop policy identity_verifications_update_admin on public.identity_verifications;

-- 2. Storage RLS for the verification-documents bucket ---------------------
-- Already private with the right MIME/size limits (supabase/config.toml)
-- — this was the actual gap: zero storage.objects policies existed for
-- it, so it was completely non-functional (safe by default, but unusable).
-- Path convention: "<user-id>/<random-token>/<filename>" — the leading
-- segment is checked directly against auth.uid(), simpler than
-- product-images' policy (which has to join back to products since that
-- bucket is scoped by product id, not user id). The random token is
-- generated server-side (randomUUID() in the submission action, never a
-- client-chosen value) purely so multiple submissions never collide —
-- it is not itself a security boundary.
create policy verification_documents_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy verification_documents_storage_select_own_or_admin
  on storage.objects for select
  using (
    bucket_id = 'verification-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- No UPDATE/DELETE policy — submissions are append-only, matching the
-- identity_verifications table itself; a document is never replaced in
-- place, a resubmission gets a fresh path.

-- 3. Internal verification-status helpers -----------------------------------
-- Never granted to authenticated/anon directly — only called from other
-- SECURITY DEFINER functions below. Exposing this one with a profile_id
-- parameter would let any signed-in user probe any other user's
-- verification state.
create function public.latest_identity_verification_status(p_profile_id uuid)
returns verification_status
language sql
stable
security definer
set search_path = public
as $$
  select status from public.identity_verifications
  where profile_id = p_profile_id
  order by created_at desc, id desc
  limit 1;
$$;

revoke execute on function public.latest_identity_verification_status(uuid) from public, anon, authenticated;

-- Account verification is read live from auth.users every single call —
-- deliberately never cached anywhere in public schema. Identity
-- verification is read from the submission table itself (via the helper
-- above), not from the profiles cache column, so this function stays
-- correct even in the one instant between a new submission landing and
-- the sync trigger (below) finishing — there's no window where this
-- function and the actual submission history disagree.
create function public.is_profile_fully_verified(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email_confirmed boolean;
  v_phone_confirmed boolean;
  v_identity_status verification_status;
begin
  select (email_confirmed_at is not null), (phone_confirmed_at is not null)
  into v_email_confirmed, v_phone_confirmed
  from auth.users where id = p_profile_id;

  if not found then
    return false;
  end if;

  v_identity_status := public.latest_identity_verification_status(p_profile_id);

  return coalesce(v_email_confirmed, false) and coalesce(v_phone_confirmed, false) and v_identity_status = 'verified';
end;
$$;

revoke execute on function public.is_profile_fully_verified(uuid) from public, anon, authenticated;

-- The one verification function meant to be called directly by a normal
-- client — but it never takes a parameter, so it can only ever answer
-- "am I, the caller, fully verified?" Never a privacy leak, and this is
-- what create_order()/the products trigger/the account page all use for
-- "is the acting user allowed to transact."
create function public.can_transact()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_profile_fully_verified(auth.uid()), false);
$$;

revoke execute on function public.can_transact() from public, anon;
grant execute on function public.can_transact() to authenticated;

-- 4. Keep profiles.identity_verification synced to the latest submission ---
-- SECURITY DEFINER because this fires from a plain, RLS-gated
-- authenticated INSERT (the user's own submission) or an admin's
-- review — neither of those roles has a column grant to write
-- profiles.identity_verification directly (by design — see
-- 20260920100000_restrict_insert_columns.sql), so the trigger needs its
-- own elevated privilege rather than inheriting the caller's. This is a
-- read-recompute-write, not a copy of NEW's own status column, so a
-- resubmission after a rejection (or after a prior approval) correctly
-- flips the cache back to whatever the true latest row says, per
-- section 11 of the brief: a fresh 'pending' submission always wins over
-- older history, verified or rejected.
create function public.sync_profile_identity_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest verification_status;
begin
  v_latest := public.latest_identity_verification_status(new.profile_id);
  update public.profiles set identity_verification = coalesce(v_latest, 'unverified') where id = new.profile_id;
  return new;
end;
$$;

create trigger identity_verifications_sync_profile
  after insert or update on public.identity_verifications
  for each row execute function public.sync_profile_identity_verification();

-- 5. Admin review — the only sanctioned way to decide a submission --------
create function public.review_identity_verification(
  p_submission_id uuid,
  p_decision verification_status,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_submission record;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin authorization required';
  end if;

  if p_decision not in ('verified', 'rejected') then
    raise exception 'A review decision must be verified or rejected';
  end if;

  select id, status into v_submission
  from public.identity_verifications
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Verification submission not found';
  end if;

  -- State-machine safety: only a currently-pending submission can be
  -- decided — matches the append-only-history philosophy (an
  -- already-decided row is never re-litigated by this function; a user
  -- who disagrees resubmits fresh instead).
  if v_submission.status <> 'pending' then
    raise exception 'This submission has already been reviewed';
  end if;

  begin
    update public.identity_verifications
    set status = p_decision, reviewed_by = v_admin_id, reviewed_at = now(), notes = p_notes
    where id = p_submission_id;
  exception when unique_violation then
    raise exception 'This ID number is already verified on a different account';
  end;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, notes)
  values (v_admin_id, 'identity_verification_' || p_decision::text, 'identity_verification', p_submission_id, p_notes);
end;
$$;

-- EXECUTE granted broadly to authenticated (there is no separate
-- Postgres role for "admin" — is_admin() checks profiles.role, a data
-- value, not something a GRANT can condition on), same pattern every
-- other is_admin()-gated boundary in this schema already uses; the
-- internal check above is the actual authorization.
revoke execute on function public.review_identity_verification(uuid, verification_status, text) from public, anon;
grant execute on function public.review_identity_verification(uuid, verification_status, text) to authenticated;

-- 6. Seller verification gate on listing publication ------------------------
-- Deliberately NOT security definer, unlike every other new function in
-- this migration — current_user must reflect the ACTUAL invoking role
-- for the exemption below to mean anything; a security definer trigger
-- would always report the function owner and silently disable the
-- exemption for everyone, defeating it. can_transact() itself is already
-- SECURITY DEFINER and works regardless of this function's own mode, so
-- no elevated privilege is lost by leaving this one as SECURITY INVOKER.
--
-- The exemption: only the genuine `authenticated` client path (i.e. a
-- real request through changeListingStatus(), the only place the
-- application ever moves a listing to 'published') is gated. A write
-- performed as postgres/service_role — test/fixture setup, migrations,
-- any future trusted server-side tooling — is already a strictly more
-- privileged, already-trusted context, exactly like every other
-- RLS/authorization boundary in this schema already treats service_role
-- (e.g. process_payfast_itn()'s own reasoning for skipping SECURITY
-- DEFINER). Checking auth.uid()/can_transact() against a role that never
-- has a signed-in user in the first place would be meaningless, not
-- extra security.
--
-- Applies uniformly regardless of seller_type: the ACTING individual
-- (auth.uid()) must be verified to publish any listing, including one
-- owned by a business they're a member of. Business-entity-level
-- verification (businesses.verification_status) is a separate, later
-- phase's concern — this checks the human performing the action, which
-- is the correct and sufficient boundary for what this phase covers.
create function public.enforce_seller_verification_on_publish()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if current_user = 'authenticated' and not public.can_transact() then
      raise exception 'Account verification required before publishing a listing.';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_enforce_seller_verification
  before insert or update on public.products
  for each row execute function public.enforce_seller_verification_on_publish();

-- 7. Buyer verification gate on order creation ------------------------------
-- Same signature as before (CREATE OR REPLACE, not DROP+CREATE) — no new
-- parameter needed, since the check is derived entirely from auth.uid()
-- and the resolved seller, not from client input.
create or replace function public.create_order(
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

  -- Phase 5: the buyer must be fully verified to transact at all — this
  -- is the platform-wide, non-configurable gate, checked before anything
  -- product-specific (mirrors the cash+delivery check's own "fail fast
  -- on caller-only facts before touching the product" reasoning).
  if not public.can_transact() then
    raise exception 'Account verification required before purchasing.';
  end if;

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
    -- Phase 5: the seller must ALSO independently satisfy the same
    -- platform-wide verification gate before cash is even considered —
    -- deliberately separate from (and checked before) Phase 4C's own
    -- configurable eligibility criteria below, so an admin disabling the
    -- requires_account_verification/requires_identity_verification cash
    -- criteria rows can never let an unverified seller through. Skipped
    -- for a business seller: business-entity verification is a later
    -- phase's scope, and evaluate_cash_eligibility()'s own business
    -- branch (unchanged by this migration) already gates on
    -- businesses.verification_status independently.
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

-- 8. accept_cash_order(): same additional verification gate, re-checked fresh --
-- Same signature (CREATE OR REPLACE). Mirrors create_order()'s cash
-- branch exactly — verification is checked before Phase 4C's own
-- eligibility re-check, both independently, both fresh every call.
create or replace function public.accept_cash_order(p_order_id uuid)
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

  if v_order.seller_type = 'parent' and not public.is_profile_fully_verified(v_order.seller_profile_id) then
    raise exception 'You are no longer eligible to accept cash orders';
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

-- 9. evaluate_cash_eligibility(): fix the account-verification criterion ----
-- Only the PARENT branch's account-verification computation changes —
-- it previously read profiles.account_verification (a stored column that
-- nothing writes anymore as of this migration; see the header comment).
-- Reading auth.users live here keeps the *configurable*
-- requires_account_verification cash criterion actually meaningful if an
-- admin keeps it active, consistent with the new authoritative source
-- used everywhere else. identity_verification (still profiles-cached,
-- kept correct by the new sync trigger) and the entire business branch
-- are UNCHANGED — business-entity verification remains out of scope for
-- this phase.
create or replace function public.evaluate_cash_eligibility(
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
  v_identity_status verification_status;
begin
  if p_seller_type = 'parent' then
    select identity_verification, completed_transaction_count, rating_average, account_standing, true
    into v_identity_status, v_completed_transactions, v_rating, v_account_standing, v_found
    from public.profiles where id = p_seller_profile_id;

    if v_found then
      select (email_confirmed_at is not null and phone_confirmed_at is not null)
      into v_account_verified
      from auth.users where id = p_seller_profile_id;
      v_account_verified := coalesce(v_account_verified, false);
      v_identity_verified := (v_identity_status = 'verified');
    end if;

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

-- 10. decline_cash_order(): close a confirmed bypass of the publish gate ---
-- Found during Phase 5's own security review of
-- enforce_seller_verification_on_publish(): that trigger deliberately
-- exempts non-'authenticated' current_user contexts (see its own
-- comment) so trusted fixture/tooling writes aren't blocked — but
-- decline_cash_order() is itself SECURITY DEFINER, so its internal
-- `products.status: sold -> published` UPDATE also runs with
-- current_user = the function owner, not 'authenticated', and was
-- therefore silently exempt from the trigger too. Confirmed
-- empirically: a seller who was fully verified when a cash order was
-- created, but whose verification later lapses (e.g. a fresh
-- resubmission flips them back to 'pending') before they decline that
-- order, could still have the listing republished with no fresh check —
-- an unintended "reactivate a listing without passing verification"
-- path, not the deliberate, documented publish-time-only gate this
-- phase actually intends.
--
-- Fix: re-validate the seller's current verification (same
-- parent-only, business-out-of-scope pattern as create_order()'s cash
-- branch and accept_cash_order()) before deciding what to revert the
-- listing to. A currently-verified seller gets the exact prior
-- behaviour (republished, immediately purchasable again). A seller who
-- is no longer fully verified still gets their order declined and the
-- commission voided — declining is a cancellation, not a sale, and
-- isn't itself gated — but the listing reverts to 'draft', not
-- 'published': safe regardless of verification state, and the seller
-- can publish it again once they satisfy
-- enforce_seller_verification_on_publish() normally.
create or replace function public.decline_cash_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order record;
  v_product_id uuid;
  v_seller_verified boolean;
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  select o.id, o.status, o.seller_type, o.seller_profile_id
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
    v_seller_verified := v_order.seller_type <> 'parent' or public.is_profile_fully_verified(v_order.seller_profile_id);
    if v_seller_verified then
      update public.products set status = 'published' where id = v_product_id and status = 'sold';
    else
      update public.products set status = 'draft' where id = v_product_id and status = 'sold';
    end if;
  end if;

  insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
  values (p_order_id, 'order', p_order_id, 'cash_order.declined', 'seller', v_seller_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.decline_cash_order(uuid, text) from public, anon;
grant execute on function public.decline_cash_order(uuid, text) to authenticated;
