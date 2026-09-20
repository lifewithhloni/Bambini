-- updated_at maintenance -----------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.delivery_orders
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.disputes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.cash_eligibility_criteria
  for each row execute function public.set_updated_at();

-- Cached rating aggregates -------------------------------------------------
-- Reviews are the source of truth; profiles/businesses.rating_average and
-- rating_count are a read-optimization cache kept in sync here so listing
-- and search queries don't have to aggregate reviews on every request.
create function public.apply_review_to_seller_rating()
returns trigger
language plpgsql
as $$
begin
  if new.seller_type = 'parent' then
    update public.profiles
    set
      rating_count = rating_count + 1,
      rating_average = (coalesce(rating_average, 0) * rating_count + new.rating) / (rating_count + 1)
    where id = new.seller_profile_id;
  else
    update public.businesses
    set
      rating_count = rating_count + 1,
      rating_average = (coalesce(rating_average, 0) * rating_count + new.rating) / (rating_count + 1)
    where id = new.business_id;
  end if;
  return new;
end;
$$;

create trigger reviews_apply_to_seller_rating
  after insert on public.reviews
  for each row execute function public.apply_review_to_seller_rating();

-- Completed transaction count ----------------------------------------------
-- Feeds the min_completed_transactions cash-eligibility criterion.
create function public.apply_order_completion_to_seller_stats()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.seller_type = 'parent' then
      update public.profiles
      set completed_transaction_count = completed_transaction_count + 1
      where id = new.seller_profile_id;
    else
      update public.businesses
      set completed_transaction_count = completed_transaction_count + 1
      where id = new.business_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_apply_completion_to_seller_stats
  after update of status on public.orders
  for each row execute function public.apply_order_completion_to_seller_stats();

-- Nearby search -------------------------------------------------------------
-- The ONLY sanctioned way to query products by proximity. It is
-- SECURITY DEFINER so it can read locations.geo (a table normal
-- anon/authenticated roles cannot SELECT directly, per the RLS policies
-- migration) but it returns only a rounded distance_km plus suburb/city
-- — never the buyer's or seller's raw latitude/longitude. This is how
-- "3.4 km away" is produced without ever exposing an exact address.
create function public.search_nearby_products(
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
  where p.status = 'active'
    and (category_filter is null or p.category_id = category_filter)
    and st_dwithin(
      l.geo,
      st_setsrid(st_makepoint(buyer_lng, buyer_lat), 4326)::geography,
      radius_km * 1000
    )
  order by distance_km asc;
$$;

grant execute on function public.search_nearby_products(double precision, double precision, double precision, uuid)
  to anon, authenticated;
