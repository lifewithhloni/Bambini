-- Phase 1 security hardening: the existing UPDATE column-level GRANTs on
-- profiles/businesses (see 20260920091500_rls_policies.sql) restrict
-- which columns a signed-in user can change after a row exists, but the
-- matching INSERT policies never restricted which columns a user could
-- set on the row's *first* insert. A user could self-verify a business
-- by including verification_status: 'verified' in the very INSERT that
-- creates it — confirmed exploitable in tests/db/rls.test.ts. This
-- mirrors the UPDATE pattern onto INSERT for every table where that
-- mattered: the omitted columns (verification_status, account_standing,
-- rating_*, completed_transaction_count, role, status, reviewed_by,
-- reviewed_at, id, created_at, ...) fall back to their column DEFAULT
-- since they're simply not in the granted column list, not because any
-- value the client sends for them is validated away.

revoke insert on public.profiles from authenticated;
grant insert (id, full_name, avatar_url, phone, location_id) on public.profiles to authenticated;

revoke insert on public.businesses from authenticated;
grant insert (
  owner_profile_id, business_name, slug, registration_number, vat_number, description, logo_url, location_id
) on public.businesses to authenticated;

revoke insert on public.business_verifications from authenticated;
grant insert (business_id, document_type, document_storage_path) on public.business_verifications to authenticated;

revoke insert on public.identity_verifications from authenticated;
grant insert (profile_id, provider, document_type, document_storage_path) on public.identity_verifications to authenticated;
