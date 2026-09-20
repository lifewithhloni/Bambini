-- Delivery quotes -----------------------------------------------------------
-- order_id is nullable: a quote is fetched at checkout (buyer comparing
-- Cheapest / Standard / Express) before an order necessarily exists, then
-- attached once the buyer picks one and the order is created.
create table public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete set null,
  pickup_location_id uuid not null references public.locations (id) on delete restrict,
  dropoff_location_id uuid not null references public.locations (id) on delete restrict,
  provider_id uuid not null references public.delivery_providers (id) on delete restrict,
  service_level delivery_service_level not null,
  price_cents bigint not null check (price_cents >= 0),
  currency text not null default 'ZAR',
  eta_min_minutes integer,
  eta_max_minutes integer,
  provider_quote_ref text not null,
  raw_response jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index delivery_quotes_order_id_idx on public.delivery_quotes (order_id);

-- Delivery orders -------------------------------------------------------
-- The booked delivery for an order, once the buyer has paid and a quote
-- has been converted into an actual courier booking.
create table public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  quote_id uuid references public.delivery_quotes (id) on delete set null,
  provider_id uuid not null references public.delivery_providers (id) on delete restrict,
  provider_tracking_ref text,
  status delivery_order_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_orders_order_id_idx on public.delivery_orders (order_id);
