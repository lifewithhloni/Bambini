export type PhoneBadgeState = "verified" | "awaiting_code" | "not_verified" | "unavailable";

/**
 * The single place the phone row's headline state is decided. "verified"
 * is returned if and only if `phoneConfirmed` — Supabase Auth's
 * phone_confirmed_at as read on the server — is true. No other input
 * (the availability flag, a pending number, an action result, a
 * profiles.phone value) can ever produce it, so the UI cannot claim a
 * verification Auth hasn't confirmed.
 *
 * `phoneVerificationAvailable` only chooses between "the flow is offered"
 * and "currently unavailable" for a phone that is NOT confirmed.
 */
export function phoneBadgeState(input: { phoneConfirmed: boolean; phoneVerificationAvailable: boolean; pendingPhone: string | null }): PhoneBadgeState {
  if (input.phoneConfirmed) return "verified";
  if (!input.phoneVerificationAvailable) return "unavailable";
  return input.pendingPhone ? "awaiting_code" : "not_verified";
}
