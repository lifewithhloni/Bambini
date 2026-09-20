-- Phase 2A ownership hardening.
--
-- 1) `products_update_owner_or_admin` (from the foundation phase) has a
-- USING clause but no explicit WITH CHECK. Postgres defaults an
-- UPDATE policy's WITH CHECK to its USING clause when none is given, so
-- this was *already* closed in practice — verified against a real
-- engine before writing this migration, not assumed — but it relied on
-- an implicit Postgres default rather than a rule visible in this
-- file. Made explicit here so "a seller cannot change who owns a
-- listing via UPDATE" is an auditable line of SQL, not something a
-- future reader has to know Postgres does implicitly.
drop policy products_update_owner_or_admin on public.products;

create policy products_update_owner_or_admin on public.products
  for update using (
    seller_profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin()
  )
  with check (
    public.is_admin()
    or (seller_type = 'parent' and seller_profile_id = auth.uid())
    or (seller_type = 'business' and public.is_business_member(business_id))
  );

-- 2) A product_images row's storage_path must live under that row's own
-- product_id folder. Without this, RLS on product_images already
-- prevents attaching an image row to a product you don't own, but
-- doesn't stop you from pointing that row's storage_path at a REAL file
-- some other product owns (e.g. one you discovered/guessed the path
-- to) — this constraint closes that: storage_path is only valid if it
-- starts with "<this row's own product_id>/". Combined with the
-- storage.objects upload policy (next migration), which only lets you
-- upload into a folder for a product you own, the two together mean a
-- path can only ever (a) have been legitimately uploaded by an owner
-- and (b) only be referenced by that same product's own image rows.
alter table public.product_images
  add constraint product_images_storage_path_matches_product
  check (storage_path like (product_id::text || '/%'));
