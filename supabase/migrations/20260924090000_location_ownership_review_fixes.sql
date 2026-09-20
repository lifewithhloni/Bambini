-- Phase 3B security review follow-up. Two independent, minimal fixes —
-- neither changes the location architecture, both close gaps a focused
-- review found in the already-shipped Phase 3B migration.
--
-- 1. profiles.location_id ownership. products.pickup_location_id got a
--    "must reference a location you created" WITH CHECK in
--    20260923090000_nearby_search.sql; profiles.location_id did not —
--    documented at the time in DECISIONS.md as a deliberate, judged-low-
--    severity gap ("doesn't leak coordinates, not one of the 12 required
--    tests"). That reasoning was correct about *exposure* (no query ever
--    returns another user's exact coordinates regardless of whose
--    location a profile points at) but missed the actual invariant:
--    a user's saved location must represent a location they are
--    authorized to use as their own, independent of whether misusing it
--    happens to leak data elsewhere. Confirmed empirically before this
--    fix, not just by reading the policy (see
--    tests/db/location-ownership.test.ts): an authenticated user could
--    freely point their own profiles.location_id at any other user's
--    locations row, on both INSERT and UPDATE. Mirrors the products fix
--    exactly — DROP + CREATE POLICY (WITH CHECK can't be altered in
--    place), admin-exempted on UPDATE (profiles_insert_own never had an
--    admin branch — an admin creating a profile on someone else's behalf
--    isn't a path this policy is for; that's handle_new_user(), which
--    runs as a trigger, not through this RLS policy at all).
--
-- 2. search_nearby_products()'s EXECUTE grant. `CREATE FUNCTION` grants
--    EXECUTE to PUBLIC by default in Postgres, unlike tables/views (which
--    get no implicit PUBLIC grant) — the previous migration granted
--    EXECUTE to anon/authenticated without ever revoking that implicit
--    default, so PUBLIC (and, redundantly, postgres and service_role)
--    also had it. Confirmed via information_schema.routine_privileges,
--    not assumed. Not an active exploit in this project's role model —
--    anon/authenticated/service_role are the only roles Supabase ever
--    lets a client request assume, and this function's own body already
--    returns only public-safe data regardless of caller identity — but
--    "EXECUTE permissions are explicitly appropriate" means precise, not
--    "happens to be harmless today." Revoked and re-granted to exactly
--    anon and authenticated.
drop policy profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (
    id = auth.uid()
    and (
      location_id is null
      or exists (
        select 1 from public.locations l
        where l.id = location_id and l.created_by = auth.uid()
      )
    )
  );

drop policy profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
  for update
  using (id = auth.uid() or public.is_admin())
  with check (
    (id = auth.uid() or public.is_admin())
    and (
      location_id is null
      or public.is_admin()
      or exists (
        select 1 from public.locations l
        where l.id = location_id and l.created_by = auth.uid()
      )
    )
  );

revoke execute on function public.search_nearby_products(
  double precision, double precision, double precision, uuid[], bigint, bigint, product_condition, boolean, boolean, text, integer, integer
) from public;
grant execute on function public.search_nearby_products(
  double precision, double precision, double precision, uuid[], bigint, bigint, product_condition, boolean, boolean, text, integer, integer
) to anon, authenticated;
