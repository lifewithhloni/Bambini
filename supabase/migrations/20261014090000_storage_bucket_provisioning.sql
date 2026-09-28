-- Phase 15B: deterministic storage bucket provisioning.
--
-- AUDIT FINDING (Phase 15A, C-3): the product-images and
-- verification-documents buckets are declared only in
-- supabase/config.toml, which applies automatically to `supabase start`
-- (local dev) but needs a separate, easy-to-forget `supabase config
-- push`-style step to reach a hosted project — nothing in this repo's
-- package.json scripts runs that step. A fresh production project
-- replaying only `supabase db push` would end up with every RLS policy on
-- storage.objects (20260921090200_product_images_storage_policies.sql,
-- 20260928090000_identity_account_verification.sql,
-- 20260929090000_business_onboarding_storefront.sql) correctly in place,
-- attached to buckets that don't exist — every upload would fail.
--
-- This uses Supabase's own documented mechanism for managing buckets via
-- SQL: storage.buckets is a plain Postgres table (not something that
-- requires the Storage HTTP API), so this migration becomes part of the
-- same deploy path as the policies that depend on it. Idempotent
-- (ON CONFLICT DO UPDATE), safe to replay, and safe to run alongside
-- config.toml's own declarative buckets for local dev — same values, so
-- whichever mechanism applies first is a no-op for the other.
--
-- Values match config.toml exactly and must be kept in sync with it and
-- with the server-side validation in src/server/listings/imageValidation.ts
-- and src/server/verification/documentValidation.ts. Both buckets stay
-- private (public = false) — reads only ever happen through a
-- short-lived signed URL (see src/server/listings/imageUrls.ts,
-- src/server/verification/adminVerifications.ts), never a public/stable
-- URL. No storage.objects RLS policy, path authorization, or signed-URL
-- behaviour is touched here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('verification-documents', 'verification-documents', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
