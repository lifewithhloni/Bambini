-- Two independent changes to the already-production-deployed
-- verification-documents bucket, in one migration since both touch the
-- same bucket and its RLS.
--
-- 1. HUMAN-READABLE STORAGE FOLDERS ------------------------------------------
--
-- The current path convention ("<user-id>/<random-token>/id-document.<ext>",
-- 20260928090000_identity_account_verification.sql) has the leading path
-- segment doing double duty: it's both a folder name AND the actual
-- authorization check — verification_documents_storage_insert_own/
-- _select_own_or_admin compare that segment directly against
-- auth.uid()::text. Switching the top-level folder to a human-readable
-- name (e.g. "Lehlohonolo_Maishoane_01") means that comparison can no
-- longer just parse the path as an identity — it needs a real, server-
-- allocated ownership record to check against instead.
--
-- verification_folder_slugs is that record: one row per profile,
-- written exactly once — on that profile's FIRST submission, by
-- allocate_verification_folder_slug() below — and reused for every
-- resubmission after that (a resubmission looks up its own existing row
-- and returns it unchanged, never allocates a second folder for the same
-- person). The function is SECURITY DEFINER and derives the profile
-- solely from auth.uid(); the caller supplies only a sanitized base name
-- (first+last name, already stripped of everything but ASCII letters/
-- digits by the application — see documentValidation.ts's
-- sanitizeFullNameForStoragePath()), never anything that could be
-- confused for a path segment with special meaning.
--
-- Collision-safe allocation under concurrency: folder_name carries a
-- UNIQUE constraint, and the function inserts inside a loop, catching
-- unique_violation and retrying the next numeric suffix — the standard,
-- textbook-correct Postgres pattern (a failed INSERT's effects roll back
-- to an implicit savepoint on exception, so the loop can safely retry in
-- the same transaction). Two people named "Lehlohonolo Maishoane"
-- submitting at the exact same moment: whichever INSERT commits first
-- gets "..._01", the other's insert collides, is caught, and retries
-- "..._02" — never a silent double-allocation, never a client-side
-- count. A double-submit race from the SAME profile is handled by the
-- table's own profile_id primary key: the loser's insert collides on
-- profile_id (not folder_name), is caught, re-selects, and returns the
-- winner's already-committed row instead of allocating a second one.
--
-- Existing documents already uploaded under the old
-- "<user-id>/<random-token>/..." convention are NOT moved, renamed, or
-- backfilled into this table — nothing here touches storage.objects
-- rows. The new SELECT policy below still resolves to "the owning
-- profile, or an admin" for ANY row in this bucket regardless of which
-- path convention it happens to use (an old-convention row simply never
-- matches a verification_folder_slugs.folder_name and so is never
-- readable via that branch — it's the storage.objects.owner_id bootstrap
-- plus the *existing, untouched* business-verification policies that
-- still apply exactly as before; admin review continues to work because
-- getVerificationSubmissionDetail() reads document_storage_path straight
-- off the identity_verifications row and mints a signed URL for exactly
-- that string, never re-deriving or assuming a path shape).
--
-- Scope: identity verification documents only. Business verification
-- documents (business/<business-id>/... , 20260929090000) are untouched
-- — different policies, different path convention, no change here.
create table public.verification_folder_slugs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  folder_name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.verification_folder_slugs enable row level security;

-- Owner-or-admin read, the same shape as every other private table in
-- this schema — not admin-only. This is required, not just permissive:
-- the storage.objects policies below check ownership via an EXISTS
-- subquery against this table, and that subquery runs under the
-- CALLING user's own RLS context (a policy expression is not a
-- SECURITY DEFINER context), so a user must be able to see their own
-- row here for their own upload/read of their own document to pass at
-- all. No INSERT/UPDATE/DELETE policy for a plain authenticated user —
-- the only legitimate writer is the SECURITY DEFINER allocation
-- function below, which bypasses RLS entirely (as every SECURITY
-- DEFINER function in this schema does for its own writes).
create policy verification_folder_slugs_select_own_or_admin on public.verification_folder_slugs
  for select using (profile_id = auth.uid() or public.is_admin());

-- Table-level SELECT is granted to anon too so the storage policies'
-- subquery can be *evaluated* for a signed-out caller without erroring
-- ("permission denied") — the policy above still returns zero rows for
-- anon (auth.uid() is null, is_admin() is false), so nothing is actually
-- exposed; this mirrors the same grant-broadly/let-RLS-filter pattern
-- already used for e.g. the notifications table in this schema.
revoke insert, update, delete on public.verification_folder_slugs from anon, authenticated;
grant select on public.verification_folder_slugs to anon, authenticated;

create function public.allocate_verification_folder_slug(p_base_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_existing text;
  v_candidate text;
  v_suffix int := 1;
  v_max_attempts constant int := 200;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;
  if p_base_name is null or length(trim(p_base_name)) = 0 then
    raise exception 'A base folder name is required';
  end if;

  select folder_name into v_existing from public.verification_folder_slugs where profile_id = v_profile_id;
  if v_existing is not null then
    return v_existing;
  end if;

  loop
    v_candidate := p_base_name || '_' || lpad(v_suffix::text, 2, '0');

    begin
      insert into public.verification_folder_slugs (profile_id, folder_name) values (v_profile_id, v_candidate);
      return v_candidate;
    exception when unique_violation then
      -- Re-check by profile_id first: if THIS profile now has a row, a
      -- concurrent call for the same person won the race — return their
      -- folder rather than looping. Otherwise the collision was on
      -- folder_name (a different person with the same base name already
      -- took this suffix) — try the next one.
      select folder_name into v_existing from public.verification_folder_slugs where profile_id = v_profile_id;
      if v_existing is not null then
        return v_existing;
      end if;
      v_suffix := v_suffix + 1;
      if v_suffix > v_max_attempts then
        raise exception 'Could not allocate a verification folder name';
      end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.allocate_verification_folder_slug(text) from public, anon;
grant execute on function public.allocate_verification_folder_slug(text) to authenticated;

-- Storage RLS, extended to ALSO authorize via verification_folder_slugs,
-- never narrowed. The original auth.uid()-based check
-- ((storage.foldername(name))[1] = auth.uid()::text) is kept as-is on
-- both INSERT and SELECT — this migration only adds the new folder-slug
-- check as a second, equally-valid way to prove ownership, it does not
-- remove or replace the first. That's deliberate, not an oversight: the
-- application (submitIdentityVerification.ts) always allocates and uses
-- the new human-readable folder for every new submission going forward,
-- so in practice new uploads already only ever use the new convention —
-- but the RLS itself stays strictly more permissive than before, never
-- less, so nothing that could previously upload/read under the old
-- convention loses that ability. The old migration that created the
-- original two policies is left untouched, per this project's standing
-- convention of never editing an already-applied migration; this drops
-- and recreates them under their existing names with the added branch.
drop policy verification_documents_storage_insert_own on storage.objects;
drop policy verification_documents_storage_select_own_or_admin on storage.objects;

create policy verification_documents_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.verification_folder_slugs s
        where s.folder_name = (storage.foldername(name))[1] and s.profile_id = auth.uid()
      )
    )
  );

create policy verification_documents_storage_select_own_or_admin
  on storage.objects for select
  using (
    bucket_id = 'verification-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text -- old-convention rows: the leading segment IS still the uid
      or exists (
        select 1 from public.verification_folder_slugs s
        where s.folder_name = (storage.foldername(name))[1] and s.profile_id = auth.uid()
      )
      or public.is_admin()
    )
  );

-- 2. 2 MiB MAXIMUM FILE SIZE ---------------------------------------------------
--
-- 2097152 bytes = 2 MiB exactly. Idempotent upsert against the same
-- bucket row 20261014090000_storage_bucket_provisioning.sql already
-- created — that migration is already applied to production and is not
-- edited here, matching this phase's own instruction. Allowed MIME types
-- and privacy (public = false) are unchanged; only the size limit moves.
-- This bucket is shared with business verification documents
-- (business/<business-id>/... , 20260929090000_business_onboarding_storefront.sql),
-- which were not asked about in this phase but necessarily share the
-- same bucket-level limit — see this migration's own application-layer
-- counterpart (documentValidation.ts) for why MAX_DOCUMENT_BYTES moves
-- to the same 2 MiB value for both document types, not just identity's.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-documents', 'verification-documents', false, 2097152, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
