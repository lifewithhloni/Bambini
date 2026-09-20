-- Phase 3A: Browse & Search.
--
-- Indexes: the existing single-column `products_status_idx` filters by
-- status but doesn't help sort, and `products_category_id_idx` doesn't
-- carry status either. The two most common browse queries this phase
-- adds — "published, newest first" and "published, sorted by price" —
-- both filter by status AND sort by one other column, which a single
-- composite index serves in one pass (filter + sort, no separate sort
-- step) where the existing single-column indexes would need one.
create index products_status_created_at_idx on public.products (status, created_at desc);
create index products_status_price_idx on public.products (status, price_cents);

-- Plain ILIKE '%term%' (a leading wildcard) can't use an ordinary btree
-- index at all — pg_trgm's GIN index is what actually accelerates it.
-- Title only, not description: title is what search primarily targets
-- and what a trigram index is worth the write overhead for; description
-- search still works (see search_products() below) but via a plain
-- sequential scan for now — fine at this phase's data volume, worth
-- revisiting only if description search becomes a real hot path (see
-- DECISIONS.md).
create extension if not exists "pg_trgm" with schema public;
create index products_title_trgm_idx on public.products using gin (title public.gin_trgm_ops);

-- search_products(): the single, safe entry point for browse/search.
-- Deliberately NOT security definer — it needs no elevated privilege;
-- the existing products/product_images RLS policies already let
-- anon/authenticated read a published listing and its images, so this
-- runs as the calling role and inherits that, same as any other
-- ordinary query. The explicit `status = 'published'` filter here is
-- defense in depth alongside RLS, not a replacement for it — identical
-- reasoning to getPublicListing()'s own query in application code.
--
-- Why a database function rather than building the query with
-- PostgREST filters in application code: every parameter here is a
-- genuine bound plpgsql parameter (no string concatenation into
-- dynamic SQL), which sidesteps a real fragility in PostgREST's
-- `.or()` filter-string DSL — a user's free-text search term can
-- contain characters (commas, parentheses) that are meaningful in that
-- DSL, and hand-escaping it correctly for every case is exactly the
-- kind of thing worth avoiding rather than getting subtly wrong. This
-- mirrors the existing search_nearby_products() precedent. `sort_key`
-- is validated against an explicit allowlist inside the function
-- (normalized to 'newest' if it isn't one of the three known values) —
-- defense in depth alongside the application-level allowlist in
-- src/server/search/sort.ts; nothing ever reaches an ORDER BY as a raw
-- client-supplied column/direction. Ordering always ends in `id desc`
-- as a final tiebreaker so pagination stays deterministic even when
-- many rows share the same price or timestamp — see DECISIONS.md.
create function public.search_products(
  search_term text default null,
  category_ids uuid[] default null,
  min_price_cents bigint default null,
  max_price_cents bigint default null,
  condition_filter product_condition default null,
  collection_only boolean default false,
  delivery_only boolean default false,
  sort_key text default 'newest',
  page_size integer default 24,
  page_offset integer default 0
)
returns table (
  id uuid,
  title text,
  price_cents bigint,
  currency text,
  condition product_condition,
  category_id uuid,
  collection_available boolean,
  delivery_available boolean,
  created_at timestamptz,
  cover_image_path text,
  total_count bigint
)
language plpgsql
stable
set search_path = public
as $$
declare
  normalized_sort text := case
    when sort_key in ('newest', 'price_asc', 'price_desc') then sort_key
    else 'newest'
  end;
  clamped_page_size integer := least(greatest(coalesce(page_size, 24), 1), 60);
  clamped_offset integer := greatest(coalesce(page_offset, 0), 0);
begin
  return query
  select
    p.id,
    p.title,
    p.price_cents,
    p.currency,
    p.condition,
    p.category_id,
    p.collection_available,
    p.delivery_available,
    p.created_at,
    (
      select pi.storage_path
      from public.product_images pi
      where pi.product_id = p.id
      order by pi.sort_order asc
      limit 1
    ) as cover_image_path,
    count(*) over () as total_count
  from public.products p
  where p.status = 'published'
    and (
      search_term is null or search_term = ''
      or p.title ilike '%' || search_term || '%'
      or p.description ilike '%' || search_term || '%'
    )
    and (category_ids is null or p.category_id = any(category_ids))
    and (min_price_cents is null or p.price_cents >= min_price_cents)
    and (max_price_cents is null or p.price_cents <= max_price_cents)
    and (condition_filter is null or p.condition = condition_filter)
    and (collection_only is not true or p.collection_available = true)
    and (delivery_only is not true or p.delivery_available = true)
  order by
    case when normalized_sort = 'price_asc' then p.price_cents end asc,
    case when normalized_sort = 'price_desc' then p.price_cents end desc,
    p.created_at desc,
    p.id desc
  limit clamped_page_size
  offset clamped_offset;
end;
$$;

grant execute on function public.search_products(
  text, uuid[], bigint, bigint, product_condition, boolean, boolean, text, integer, integer
) to anon, authenticated;
