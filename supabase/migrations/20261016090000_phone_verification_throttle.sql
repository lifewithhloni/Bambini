-- Phase 15A.1 — phone verification foundation.
--
-- What this migration is, and is not:
--
--   * It adds ONE small abuse-protection table + two service-role-only
--     functions used by the phone-verification server actions
--     (src/server/phone/) to rate-limit "send a code" / "check a code"
--     attempts. It stores a throttle SUBJECT ("user:<uuid>" or a
--     one-way hash of an IP address), an action name and a timestamp.
--
--   * It does NOT store phone numbers, OTP codes, or any verification
--     state. Supabase Auth (auth.users.phone / phone_confirmed_at, via
--     auth.updateUser + auth.verifyOtp type 'phone_change') remains the
--     only place a phone number is ever confirmed. can_transact() and
--     is_profile_fully_verified() are NOT touched: they still read
--     auth.users.phone_confirmed_at live.
--
--   * It does NOT change any grant on profiles.phone (the follow-up
--     migration 20261016090100 revokes client INSERT/UPDATE on it). The
--     column is retained but is documented as NON-AUTHORITATIVE (see the
--     COMMENT below) — nothing reads it for verification, and the app no
--     longer writes it.
--
-- Access model: RLS is enabled with NO policies and every client-role
-- privilege is revoked, so anon/authenticated can neither read nor write
-- the table directly. The only door is the SECURITY DEFINER functions
-- below, whose EXECUTE is granted to service_role only — i.e. the Next.js
-- server's admin client, never a browser-held key.

create table public.phone_verification_throttle (
  id         bigint generated always as identity primary key,
  -- 'user:<auth uid>' or 'ip:<truncated sha-256 of the client IP>'.
  subject    text not null check (char_length(subject) between 1 and 128),
  action     text not null check (action in ('send', 'verify')),
  created_at timestamptz not null default now()
);

create index phone_verification_throttle_lookup_idx
  on public.phone_verification_throttle (subject, action, created_at desc);

alter table public.phone_verification_throttle enable row level security;
revoke all on table public.phone_verification_throttle from public, anon, authenticated;

-- Atomically decides whether one more attempt is allowed for
-- (subject, action) and — when p_record is true and it is allowed —
-- records it. p_record = false is a read-only peek (used to show a resend
-- countdown on page load without consuming an attempt).
--
--   p_max             max attempts inside the rolling window
--   p_window_seconds  rolling window length
--   p_cooldown_seconds minimum gap since the LAST attempt (0 = none)
--
-- Returns (allowed, retry_after_seconds). The advisory lock serializes
-- concurrent calls for the same subject+action so two parallel requests
-- can't both slip under the limit.
create or replace function public.phone_throttle_hit(
  p_subject text,
  p_action text,
  p_max integer,
  p_window_seconds integer,
  p_cooldown_seconds integer default 0,
  p_record boolean default true
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now        timestamptz := clock_timestamp();
  v_count      integer;
  v_oldest     timestamptz;
  v_last       timestamptz;
  v_retry      integer := 0;
begin
  if p_action not in ('send', 'verify') then
    raise exception 'invalid action';
  end if;
  if p_max < 1 or p_window_seconds < 1 or p_cooldown_seconds < 0 then
    raise exception 'invalid throttle parameters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_subject || ':' || p_action, 0));

  -- Opportunistic retention: nothing older than a day is ever consulted.
  delete from public.phone_verification_throttle
   where subject = p_subject and action = p_action
     and created_at < v_now - interval '1 day';

  select count(*), min(created_at), max(created_at)
    into v_count, v_oldest, v_last
    from public.phone_verification_throttle
   where subject = p_subject and action = p_action
     and created_at > v_now - make_interval(secs => p_window_seconds);

  if p_cooldown_seconds > 0 and v_last is not null
     and v_last + make_interval(secs => p_cooldown_seconds) > v_now then
    v_retry := ceil(extract(epoch from (v_last + make_interval(secs => p_cooldown_seconds) - v_now)))::integer;
  end if;

  if v_count >= p_max then
    v_retry := greatest(
      v_retry,
      ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - v_now)))::integer
    );
  end if;

  if v_retry > 0 then
    return query select false, v_retry;
    return;
  end if;

  if p_record then
    insert into public.phone_verification_throttle (subject, action, created_at)
    values (p_subject, p_action, v_now);
  end if;

  return query select true, 0;
end;
$$;

-- Clears a subject's attempts for one action — called after a SUCCESSFUL
-- code verification so a user who proved possession isn't left counting
-- toward a lockout.
create or replace function public.phone_throttle_reset(p_subject text, p_action text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.phone_verification_throttle where subject = p_subject and action = p_action;
$$;

revoke all on function public.phone_throttle_hit(text, text, integer, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.phone_throttle_reset(text, text) from public, anon, authenticated;
grant execute on function public.phone_throttle_hit(text, text, integer, integer, integer, boolean) to service_role;
grant execute on function public.phone_throttle_reset(text, text) to service_role;

comment on table public.phone_verification_throttle is
  'Phase 15A.1 abuse-protection counters for phone-verification send/verify attempts. Holds NO phone numbers and NO OTP codes. Service-role access only (RLS on, no policies, client privileges revoked).';

comment on column public.profiles.phone is
  'NON-AUTHORITATIVE legacy contact column. NEVER proof of phone verification: the verified phone is auth.users.phone with auth.users.phone_confirmed_at (read live by can_transact()). Retained to avoid migration risk; the app no longer writes or reads it, and clients have no INSERT/UPDATE privilege on it (20261016090100).';
