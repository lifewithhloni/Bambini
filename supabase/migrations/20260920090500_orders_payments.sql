-- Orders ------------------------------------------------------------------
-- One order = one seller (a multi-seller cart is split into one order per
-- seller at checkout, since collection/delivery/payout are per-seller).
-- commission_rate_bps / commission_amount_cents are snapshotted at
-- creation from commission_rates + calculateCommission() — never
-- recomputed from a "current" rate later, so historical orders stay
-- accurate even after a rate change.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  seller_type seller_type not null,
  seller_profile_id uuid references public.profiles (id) on delete restrict,
  business_id uuid references public.businesses (id) on delete restrict,
  fulfilment_type fulfilment_type not null,
  payment_method payment_method not null,
  status order_status not null default 'pending_payment',
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  commission_amount_cents bigint not null check (commission_amount_cents >= 0),
  currency text not null default 'ZAR',
  delivery_location_id uuid references public.locations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint orders_seller_matches_type check (
    (seller_type = 'parent' and seller_profile_id is not null and business_id is null)
    or (seller_type = 'business' and business_id is not null and seller_profile_id is null)
  ),
  constraint orders_delivery_location_required check (
    fulfilment_type = 'collection' or delivery_location_id is not null
  )
);

create index orders_buyer_id_idx on public.orders (buyer_id);
create index orders_seller_profile_id_idx on public.orders (seller_profile_id);
create index orders_business_id_idx on public.orders (business_id);
create index orders_status_idx on public.orders (status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  title_snapshot text not null,
  price_cents_snapshot bigint not null check (price_cents_snapshot >= 0),
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

-- Payments ------------------------------------------------------------------
-- Every order gets exactly one payments row, including cash orders
-- (method = 'cash', provider_id null) — "every transaction has a
-- record" applies to cash the same as online payments. A cash payment's
-- status moves pending -> paid when the collection_confirmations code is
-- verified (see cash_collection migration + transaction_events).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  provider_id uuid references public.payment_providers (id) on delete restrict,
  provider_reference text,
  method payment_method not null,
  status payment_status not null default 'pending',
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'ZAR',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_provider_required_when_online check (
    method = 'cash' or provider_id is not null
  )
);

create index payments_order_id_idx on public.payments (order_id);

-- Commissions -----------------------------------------------------------
-- Append-only ledger mirroring orders.commission_*; kept as its own
-- table (rather than only columns on orders) so refunds/disputes can
-- record commission adjustments as new rows without mutating history.
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  seller_type seller_type not null,
  rate_bps integer not null check (rate_bps between 0 and 10000),
  base_amount_cents bigint not null check (base_amount_cents >= 0),
  commission_amount_cents bigint not null check (commission_amount_cents >= 0),
  created_at timestamptz not null default now()
);

create index commissions_order_id_idx on public.commissions (order_id);
