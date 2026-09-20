-- Businesses ------------------------------------------------------------
-- A verified storefront owned by a profile. Owning a business is
-- additive to a profile, not a replacement role: the owner can still
-- buy and sell personally as a parent.
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete restrict,
  business_name text not null,
  slug text not null unique,
  registration_number text,
  vat_number text,
  description text,
  logo_url text,
  location_id uuid references public.locations (id) on delete set null,
  verification_status verification_status not null default 'unverified',
  account_standing account_standing not null default 'good',
  rating_average numeric(3, 2),
  rating_count integer not null default 0,
  completed_transaction_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_owner_profile_id_idx on public.businesses (owner_profile_id);

-- Business staff (owner is implicit; this covers additional team members
-- who need dashboard access without owning the storefront).
create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (business_id, profile_id)
);

create table public.business_verifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  document_type text not null,
  document_storage_path text not null,
  status verification_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index business_verifications_business_id_idx on public.business_verifications (business_id);
