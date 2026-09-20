-- Payouts -------------------------------------------------------------------
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  recipient_type seller_type not null,
  recipient_profile_id uuid references public.profiles (id) on delete restrict,
  recipient_business_id uuid references public.businesses (id) on delete restrict,
  amount_cents bigint not null check (amount_cents >= 0),
  status payout_status not null default 'pending',
  period_start timestamptz not null,
  period_end timestamptz not null,
  provider_reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint payouts_recipient_matches_type check (
    (recipient_type = 'parent' and recipient_profile_id is not null and recipient_business_id is null)
    or (recipient_type = 'business' and recipient_business_id is not null and recipient_profile_id is null)
  )
);

create index payouts_recipient_profile_id_idx on public.payouts (recipient_profile_id);
create index payouts_recipient_business_id_idx on public.payouts (recipient_business_id);

-- Line items tying a payout back to the specific orders it settles, for
-- audit ("why is this payout this amount?").
create table public.payout_items (
  payout_id uuid not null references public.payouts (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete restrict,
  amount_cents bigint not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  primary key (payout_id, order_id)
);

-- Refunds ---------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  reason text not null,
  status refund_status not null default 'requested',
  requested_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index refunds_order_id_idx on public.refunds (order_id);
