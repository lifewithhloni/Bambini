-- Commission rates --------------------------------------------------------
-- Append-only rate history instead of a single mutable percentage column:
-- a rate change must never rewrite the commission already recorded on a
-- past order. "Current" rate = latest row with effective_from <= now()
-- for that seller_type; every order snapshots the rate_bps it actually
-- used onto commissions.rate_bps at creation time.
create table public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  seller_type seller_type not null,
  rate_bps integer not null check (rate_bps between 0 and 10000),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index commission_rates_lookup_idx on public.commission_rates (seller_type, effective_from desc);

-- Provider registries -------------------------------------------------------
-- Mirrors the DeliveryProvider / PaymentProvider adapter registries in
-- src/server/. `config` holds only non-secret, per-provider settings
-- (e.g. default service area); API keys stay in environment variables,
-- never in the database.
create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.delivery_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Cash eligibility criteria -------------------------------------------------
-- Mirrors CashEligibilityCriterion in
-- src/server/cash-eligibility/evaluateCashEligibility.ts. Admin-editable
-- so the eligibility bar can be tuned without a deploy.
create table public.cash_eligibility_criteria (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  threshold jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
