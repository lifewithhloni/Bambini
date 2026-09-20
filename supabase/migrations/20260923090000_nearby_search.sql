-- Phase 3B: Nearby + location privacy.
--
-- Three things happen in this migration:
--
-- 1. search_nearby_products() is extended in place (DROP + CREATE, since
--    both its argument list and its return columns change — CREATE OR
--    REPLACE cannot alter a RETURNS TABLE column set, verified against a
--    real engine before finalizing this file). It stays SECURITY DEFINER
--    for the same reason it always was: an anonymous/authenticated buyer
--    has no SELECT grant on `locations` at all (see
--    locations_select_own_or_admin in 20260920091500_rls_policies.sql —
--    owner+admin only), so a non-definer function joining into a
--    seller's location row would simply see zero rows for every seller
--    but the caller themselves. SECURITY DEFINER is what lets this
--    function read the location a buyer isn't allowed to query directly
--    and hand back only the derived, public-safe fields — the "controlled
--    database function" boundary between the private locations table and
--    the public Nearby result. This is a stricter contract than
--    search_products() (never SECURITY DEFINER, see
--    20260922090000_search_products.sql): every column returned here has
--    been deliberately chosen to be safe to expose, not just "whatever
--    the query needs."
--
--    New: category is now an array (matching search_products()'s
--    category_ids, resolved leaf-descendant ids from the app's category
--    tree — see src/server/categories/tree.ts) instead of a single uuid;
--    price/condition/collection/delivery filters, pagination
--    (page_size/page_offset/total_count) and multi-sort (distance,
--    newest, price_asc, price_desc) are added, all mirroring
--    search_products()'s own patterns exactly — same clamping style, same
--    allowlist-inside-the-function defense in depth, same `id desc` final
--    tiebreaker for deterministic pagination. radius_km is clamped to the
--    four supported filter values (5/10/25/50) rather than accepting an
--    arbitrary client-supplied radius, matching
--    src/server/search/radius.ts's allowlist on the app side.
--
--    Removed vs. the old return shape: seller_type, seller_profile_id,
--    business_id. None of those were ever exact-address-level data, but
--    they're also not on the documented minimal public field list this
--    phase's spec requires (listing/card fields, approximate distance,
--    public suburb/city) and nothing in the app needs them for a Nearby
--    card, so they're dropped rather than carried forward "just in case."
--
-- 2. products_pickup_location_id_idx: search_nearby_products() starts
--    from `locations` (filtered by ST_DWithin, using the existing
--    locations_geo_idx GiST index — inspected, already present since
--    Phase 0, not recreated here) and joins into `products` on
--    `pickup_location_id`. Every other foreign key products joins
--    through in a hot path already has its own index (category_id,
--    seller_profile_id, business_id — see
--    20260920090300_categories_and_products.sql); pickup_location_id was
--    the one left over from before any query actually joined through it.
--    Not redundant with anything existing — confirmed by inspecting
--    pg_indexes for the products table before adding this.
--
-- 3. Ownership hardening on products.pickup_location_id: neither
--    products_insert_owner nor products_update_owner_or_admin has ever
--    constrained *which* location a listing can reference — only that
--    the listing itself belongs to the caller. That means, until this
--    migration, a seller could set pickup_location_id to any location
--    row's id at all, including one created by a completely different
--    user, as long as they otherwise owned the listing being
--    inserted/updated. The application layer (src/server/listings/
--    actions.ts) never lets a client supply pickup_location_id directly —
--    it's always computed server-side from the caller's own
--    profiles.location_id — but RLS is the actual security boundary here,
--    not application code (see DECISIONS.md), so a direct RPC/PostgREST
--    call bypassing the server action must be stopped at this layer too.
--    Both policies are redefined (DROP + CREATE — Postgres has no ALTER
--    POLICY for changing a WITH CHECK expression) with an added clause:
--    pickup_location_id, if set, must reference a location this specific
--    caller (auth.uid()) created. is_admin() is exempted, consistent with
--    every other ownership check in this schema.
drop function public.search_nearby_products(double precision, double precision, double precision, uuid);

create function public.search_nearby_products(
  buyer_lat double precision,
  buyer_lng double precision,
  radius_km double precision default 10,
  category_ids uuid[] default null,
  min_price_cents bigint default null,
  max_price_cents bigint default null,
  condition_filter product_condition default null,
  collection_only boolean default false,
  delivery_only boolean default false,
  sort_key text default 'distance',
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
  distance_km numeric,
  suburb text,
  city text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_sort text := case
    when sort_key in ('distance', 'newest', 'price_asc', 'price_desc') then sort_key
    else 'distance'
  end;
  clamped_radius_km double precision := case
    when radius_km in (5, 10, 25, 50) then radius_km
    else 10
  end;
  clamped_page_size integer := least(greatest(coalesce(page_size, 24), 1), 60);
  clamped_offset integer := greatest(coalesce(page_offset, 0), 0);
  buyer_point geography := st_setsrid(st_makepoint(buyer_lng, buyer_lat), 4326)::geography;
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
    round((st_distance(l.geo, buyer_point) / 1000)::numeric, 1) as distance_km,
    l.suburb,
    l.city,
    count(*) over () as total_count
  from public.products p
  join public.locations l on l.id = p.pickup_location_id
  where p.status = 'published'
    and (category_ids is null or p.category_id = any(category_ids))
    and (min_price_cents is null or p.price_cents >= min_price_cents)
    and (max_price_cents is null or p.price_cents <= max_price_cents)
    and (condition_filter is null or p.condition = condition_filter)
    and (collection_only is not true or p.collection_available = true)
    and (delivery_only is not true or p.delivery_available = true)
    and st_dwithin(l.geo, buyer_point, clamped_radius_km * 1000)
  order by
    -- Recomputes the raw distance rather than referencing the
    -- `distance_km` SELECT-list alias — that alias name collides with
    -- this function's own RETURNS TABLE OUT parameter of the same name,
    -- and PL/pgSQL resolves a bare identifier matching a declared
    -- variable to that variable (always NULL here, since RETURN QUERY
    -- never assigns it) rather than the query's own column, silently
    -- turning this into a no-op sort key. Verified against a real engine
    -- — the alias-reference version compiled and ran without error but
    -- produced created_at-order results regardless of sort_key. No
    -- rounding here (unlike the SELECT list's displayed distance_km):
    -- comparing the raw geography distance sorts identically to the
    -- rounded value except at a rounding-boundary tie, which doesn't
    -- matter for ordering purposes.
    case when normalized_sort = 'distance' then st_distance(l.geo, buyer_point) end asc,
    case when normalized_sort = 'price_asc' then p.price_cents end asc,
    case when normalized_sort = 'price_desc' then p.price_cents end desc,
    p.created_at desc,
    p.id desc
  limit clamped_page_size
  offset clamped_offset;
end;
$$;

grant execute on function public.search_nearby_products(
  double precision, double precision, double precision, uuid[], bigint, bigint, product_condition, boolean, boolean, text, integer, integer
) to anon, authenticated;

create index products_pickup_location_id_idx on public.products (pickup_location_id);

drop policy products_insert_owner on public.products;
create policy products_insert_owner on public.products
  for insert with check (
    (
      (seller_type = 'parent' and seller_profile_id = auth.uid())
      or (seller_type = 'business' and public.is_business_member(business_id))
    )
    and (
      pickup_location_id is null
      or exists (
        select 1 from public.locations l
        where l.id = pickup_location_id and l.created_by = auth.uid()
      )
    )
  );

drop policy products_update_owner_or_admin on public.products;
create policy products_update_owner_or_admin on public.products
  for update
  using (
    seller_profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin()
  )
  with check (
    (seller_profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin())
    and (
      pickup_location_id is null
      or public.is_admin()
      or exists (
        select 1 from public.locations l
        where l.id = pickup_location_id and l.created_by = auth.uid()
      )
    )
  );
