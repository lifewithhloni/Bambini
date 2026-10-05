-- Phase 15A.1 hardening — profiles.phone is no longer client-writable.
--
-- profiles.phone is a retained, NON-AUTHORITATIVE legacy column (see the
-- COMMENT in 20261016090000_phone_verification_throttle.sql): the verified
-- phone is auth.users.phone + phone_confirmed_at, set only by Supabase Auth
-- after an OTP check. The application no longer reads or writes the column
-- (ProfileForm/updateProfile/getAccountOverview were all changed), and the
-- audit found no legitimate client INSERT/UPDATE path:
--
--   * the only code that ever inserts a profile is handle_new_user()
--     (SECURITY DEFINER, columns id + full_name only — unaffected by
--     grants to `authenticated`);
--   * the only client UPDATEs of profiles are full_name (updateProfile)
--     and location_id (location actions).
--
-- So a client could only use the column to plant an unverified, spoofable
-- "phone" on its own row. This removes that ability.
--
-- Deliberately NOT done: the column is not dropped, existing stored values
-- are untouched (a user can still SELECT their own row), SELECT grants and
-- RLS are unchanged, and nothing is altered for service_role/postgres or
-- for the SECURITY DEFINER trigger. Every other column grant on profiles
-- (full_name, avatar_url, location_id, and id on insert) is preserved.

revoke update (phone) on public.profiles from authenticated;
revoke insert (phone) on public.profiles from authenticated;
