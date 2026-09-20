-- Collection confirmations ---------------------------------------------
-- Created whenever fulfilment_type = 'collection' (cash or online-paid).
-- For a cash order specifically: buyer pays the seller in person, the
-- seller enters collection_code in the app, and that confirmation is
-- what flips payments.status to 'paid' and orders.status to
-- 'completed' — never the buyer's or seller's say-so alone.
create table public.collection_confirmations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  collection_code text not null unique,
  code_generated_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  buyer_present boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- Seller cash eligibility -------------------------------------------------
-- Current, server-computed snapshot of whether a seller may offer "Cash
-- at Collection" — mirrors evaluateCashEligibility() in
-- src/server/cash-eligibility/. New sellers default to ineligible
-- (is_eligible = false) and only unlock cash once the configured
-- cash_eligibility_criteria are met; recomputed by a scheduled job or
-- trigger on the events that can change eligibility (verification,
-- completed order, dispute, rating).
create table public.seller_cash_status (
  id uuid primary key default gen_random_uuid(),
  seller_type seller_type not null,
  seller_profile_id uuid references public.profiles (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,
  is_eligible boolean not null default false,
  failed_criteria text[] not null default '{}',
  evaluated_at timestamptz not null default now(),
  constraint seller_cash_status_matches_type check (
    (seller_type = 'parent' and seller_profile_id is not null and business_id is null)
    or (seller_type = 'business' and business_id is not null and seller_profile_id is null)
  )
);

create unique index seller_cash_status_profile_idx
  on public.seller_cash_status (seller_profile_id)
  where seller_profile_id is not null;

create unique index seller_cash_status_business_idx
  on public.seller_cash_status (business_id)
  where business_id is not null;
