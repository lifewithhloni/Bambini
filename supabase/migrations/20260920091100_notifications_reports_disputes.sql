-- Notifications -------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_id_idx on public.notifications (profile_id, created_at desc);

-- Reports (user-generated, against a listing/profile/business/message/review) --
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_type report_target_type not null,
  reported_id uuid not null,
  reason text not null,
  details text,
  status report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index reports_status_idx on public.reports (status);

-- Disputes (order-level) ---------------------------------------------------
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  raised_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  description text,
  status dispute_status not null default 'open',
  resolution_notes text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disputes_order_id_idx on public.disputes (order_id);
create index disputes_status_idx on public.disputes (status);
