-- Locations -----------------------------------------------------------------
-- General-purpose point store used for a profile's approximate home area,
-- a product's pickup point, and an order's delivery address. Raw lat/lng
-- and formatted_address are precise and PRIVATE — RLS (see
-- 20260920091500_rls_policies.sql) restricts row SELECT to the owner and
-- admins. Public "nearby" browsing never reads this table directly; it
-- goes through the search_nearby_products() function, which returns only
-- a rounded distance.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  label text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  geo geography(point, 4326) generated always as (
    st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
  ) stored,
  suburb text,
  city text,
  province text,
  postal_code text,
  formatted_address text,
  created_at timestamptz not null default now()
);

create index locations_geo_idx on public.locations using gist (geo);

-- Profiles --------------------------------------------------------------
-- One row per authenticated user (public.profiles.id === auth.users.id).
-- "business" is not a profile role: a business storefront is a separate
-- capability a profile can own (see businesses table) so a parent can
-- both buy/sell personally and own a storefront without a role conflict.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'parent',
  full_name text not null,
  avatar_url text,
  phone text,
  location_id uuid references public.locations (id) on delete set null,
  account_verification verification_status not null default 'unverified',
  identity_verification verification_status not null default 'unverified',
  account_standing account_standing not null default 'good',
  -- Cached aggregates maintained by triggers (see functions_and_triggers
  -- migration) — never written to directly by application code, and
  -- never trusted as-is for authorization decisions like cash
  -- eligibility without re-deriving from the source tables server-side.
  rating_average numeric(3, 2),
  rating_count integer not null default 0,
  completed_transaction_count integer not null default 0,
  is_parent_plus boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_location_id_idx on public.profiles (location_id);

-- Identity verification (KYC) -------------------------------------------
-- Separate from business_verifications: this is an individual (parent
-- seller) identity check, one of the configurable cash-eligibility
-- criteria evaluated by evaluateCashEligibility().
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  document_type text not null,
  document_storage_path text not null,
  status verification_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index identity_verifications_profile_id_idx on public.identity_verifications (profile_id);
