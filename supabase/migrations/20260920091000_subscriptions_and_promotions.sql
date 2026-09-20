-- Subscriptions (Parent+) --------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  plan text not null default 'parent_plus',
  status subscription_status not null default 'active',
  price_cents bigint not null default 5900,
  currency text not null default 'ZAR',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  provider_subscription_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscriptions_one_active_per_profile
  on public.subscriptions (profile_id)
  where status = 'active';

create table public.subscription_transactions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  status payment_status not null,
  billing_period_start timestamptz not null,
  billing_period_end timestamptz not null,
  created_at timestamptz not null default now()
);

create index subscription_transactions_subscription_id_idx
  on public.subscription_transactions (subscription_id);

-- Promotions (promoted listings) -------------------------------------------
-- price_cents_snapshot preserves what was actually charged (R30/R60/R100)
-- even if pricing tiers change later.
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  tier text not null check (tier in ('boost_30', 'boost_60', 'boost_100')),
  price_cents_snapshot bigint not null check (price_cents_snapshot >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status promotion_status not null default 'pending_payment',
  payment_id uuid references public.payments (id) on delete set null,
  created_at timestamptz not null default now()
);

create index promotions_product_id_idx on public.promotions (product_id);
