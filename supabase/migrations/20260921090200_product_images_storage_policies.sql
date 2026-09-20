-- Storage RLS for the `product-images` bucket. This targets
-- `storage.objects`, the table Supabase's platform provisions for every
-- project (not created here) — see supabase/config.toml, where this
-- bucket is now `public = false`.
--
-- A public bucket serves objects from an unauthenticated endpoint that
-- bypasses RLS entirely, which cannot satisfy "draft listings' images
-- aren't publicly viewable" or "storage policies prevent unauthorized
-- reads" — a public bucket has no reads to prevent. A private bucket
-- with these policies means every read goes through
-- storage.download()/createSignedUrl(), which does enforce RLS.
--
-- Path convention: every object lives at "<product_id>/<filename>" —
-- no bucket name prefix needed, the bucket itself scopes that. Ownership
-- is resolved by joining the path's leading segment back to
-- public.products, exactly the same seller_profile_id / is_business_member
-- check every other product policy in this schema uses.
create policy product_images_storage_insert_owner
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[1]
        and (p.seller_profile_id = auth.uid() or public.is_business_member(p.business_id))
    )
  );

-- Readable by anon too: a published listing's photos must be visible to
-- a logged-out visitor on the public product page. Draft/archived
-- listings fall through to the owner/admin branch only.
create policy product_images_storage_select
  on storage.objects for select
  using (
    bucket_id = 'product-images'
    and exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[1]
        and (
          p.status = 'published'
          or p.seller_profile_id = auth.uid()
          or public.is_business_member(p.business_id)
          or public.is_admin()
        )
    )
  );

create policy product_images_storage_delete_owner
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[1]
        and (p.seller_profile_id = auth.uid() or public.is_business_member(p.business_id) or public.is_admin())
    )
  );
