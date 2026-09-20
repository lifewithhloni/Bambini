-- Messaging -----------------------------------------------------------------
create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete set null,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_type seller_type not null,
  seller_profile_id uuid references public.profiles (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint message_threads_seller_matches_type check (
    (seller_type = 'parent' and seller_profile_id is not null and business_id is null)
    or (seller_type = 'business' and business_id is not null and seller_profile_id is null)
  )
);

create index message_threads_buyer_id_idx on public.message_threads (buyer_id);
create index message_threads_seller_profile_id_idx on public.message_threads (seller_profile_id);
create index message_threads_business_id_idx on public.message_threads (business_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index messages_thread_id_idx on public.messages (thread_id, created_at);

-- Reviews -----------------------------------------------------------------
-- One review per completed order, left by the buyer about the seller.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  seller_type seller_type not null,
  seller_profile_id uuid references public.profiles (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  seller_response text,
  created_at timestamptz not null default now(),
  constraint reviews_seller_matches_type check (
    (seller_type = 'parent' and seller_profile_id is not null and business_id is null)
    or (seller_type = 'business' and business_id is not null and seller_profile_id is null)
  )
);

create index reviews_seller_profile_id_idx on public.reviews (seller_profile_id);
create index reviews_business_id_idx on public.reviews (business_id);
