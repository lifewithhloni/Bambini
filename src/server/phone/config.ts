/**
 * Phone verification availability — configuration only.
 *
 * `PHONE_VERIFICATION_ENABLED=true` means "an SMS provider has been
 * connected to Supabase Auth and the Phone provider is enabled — show and
 * accept the verification flow". It is a UI/action gate ONLY. It never
 * marks anyone verified and never touches can_transact(): the database
 * still requires auth.users.phone_confirmed_at, which only Supabase Auth
 * sets, after a real OTP check. With the flag off (the default) the flow
 * is hidden/refused and every unverified phone stays unverified.
 *
 * A plain process.env read (not getServerEnv()) so it never throws on
 * unrelated missing variables and is trivially stubbable in tests.
 */
export function isPhoneVerificationEnabled(): boolean {
  return process.env.PHONE_VERIFICATION_ENABLED === "true";
}
