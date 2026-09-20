-- Categories --------------------------------------------------------------
-- Self-referential tree, database-driven per the product spec (no
-- hard-coded category list in the app). Seed data lives in
-- supabase/seed.sql.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete cascade,
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index categories_parent_id_idx on public.categories (parent_id);

-- Products ------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_type seller_type not null,
  seller_profile_id uuid references public.profiles (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  title text not null,
  description text,
  condition product_condition not null,
  price_cents bigint not null check (price_cents >= 0),
  currency text not null default 'ZAR',
  collection_available boolean not null default true,
  delivery_available boolean not null default true,
  pickup_location_id uuid references public.locations (id) on delete set null,
  status product_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_seller_matches_type check (
    (seller_type = 'parent' and seller_profile_id is not null and business_id is null)
    or (seller_type = 'business' and business_id is not null and seller_profile_id is null)
  )
);

create index products_category_id_idx on public.products (category_id);
create index products_seller_profile_id_idx on public.products (seller_profile_id);
create index products_business_id_idx on public.products (business_id);
create index products_status_idx on public.products (status);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images (product_id);

create table public.product_favourites (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, product_id)
);
