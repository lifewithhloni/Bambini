-- Phase 2A: align the foundation-phase enums with the agreed listing
-- model. `product_condition` had 'new' where the product now specifies
-- "Like New / Excellent / Good / Fair"; `product_status` had a broader
-- 'active'/'sold'/'removed' set where Phase 2A specifies an explicit
-- draft/published/archived lifecycle and no order-related listing
-- states. `sold`/`removed` are deliberately left as unused, inert enum
-- labels rather than dropped — Postgres has no `DROP VALUE` for enums,
-- and removing them would require recreating the type and cascading
-- through every dependent view/policy/function for no functional gain
-- this phase; see DECISIONS.md.
--
-- RENAME VALUE changes only the label, not the underlying enum OID, so
-- an RLS policy or view referencing the old label (their quals are
-- stored as bound expression trees keyed by OID) picks up the new label
-- automatically — verified against a real Postgres engine. A `language
-- sql` FUNCTION body does NOT get this for free: Postgres re-parses/
-- re-validates a SQL-language function's source text (rather than a
-- frozen bound expression) on each use, so a literal like 'active' in
-- its body must be updated explicitly or every call fails with
-- "invalid input value for enum product_status" — also discovered by
-- testing this migration against a real engine before finalizing it,
-- not assumed. search_nearby_products() is therefore explicitly
-- redefined below with the corrected literal.
alter type product_condition rename value 'new' to 'excellent';
alter type product_status rename value 'active' to 'published';

create or replace function public.search_nearby_products(
  buyer_lat double precision,
  buyer_lng double precision,
  radius_km double precision default 10,
  category_filter uuid default null
)
returns table (
  product_id uuid,
  title text,
  price_cents bigint,
  currency text,
  condition product_condition,
  category_id uuid,
  seller_type seller_type,
  seller_profile_id uuid,
  business_id uuid,
  suburb text,
  city text,
  distance_km numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as product_id,
    p.title,
    p.price_cents,
    p.currency,
    p.condition,
    p.category_id,
    p.seller_type,
    p.seller_profile_id,
    p.business_id,
    l.suburb,
    l.city,
    round(
      (st_distance(l.geo, st_setsrid(st_makepoint(buyer_lng, buyer_lat), 4326)::geography) / 1000)::numeric,
      1
    ) as distance_km
  from public.products p
  join public.locations l on l.id = p.pickup_location_id
  where p.status = 'published'
    and (category_filter is null or p.category_id = category_filter)
    and st_dwithin(
      l.geo,
      st_setsrid(st_makepoint(buyer_lng, buyer_lat), 4326)::geography,
      radius_km * 1000
    )
  order by distance_km asc;
$$;
