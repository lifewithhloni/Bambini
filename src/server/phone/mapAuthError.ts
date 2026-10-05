import { PHONE_MESSAGES } from "./types";

export type PhoneAuthErrorKind = "rate_limited" | "invalid_code" | "provider_unavailable" | "send_failed";

type AuthErrorLike = { code?: string | undefined; status?: number | undefined; message?: string | undefined } | null | undefined;

/**
 * Collapses a raw Supabase Auth error into one of four coarse kinds. The
 * raw error (its message can echo the phone number, and provider failures
 * can expose provider/account detail) never leaves this function: callers
 * receive only the kind and pick their own fixed, user-safe message.
 *
 * Notably "phone_exists" (the number belongs to another account) maps to
 * the SAME kind and message as any other send failure, so the response
 * can't be used to discover which numbers are registered.
 */
export function mapPhoneAuthError(error: AuthErrorLike): PhoneAuthErrorKind {
  const code = error?.code;
  if (code === "over_sms_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429) return "rate_limited";
  if (code === "otp_expired") return "invalid_code";
  // A failure inside the Send SMS Hook (refused send, provider outage, throttle,
  // kill switch) reaches the client as a server error from Auth, not as a
  // "phone" error — treat any 5xx as the service being unavailable.
  if (typeof error?.status === "number" && error.status >= 500) return "provider_unavailable";
  if (code === "phone_provider_disabled" || code === "sms_send_failed" || code === "otp_disabled" || code === "hook_timeout" || code === "hook_timeout_after_retry") {
    return "provider_unavailable";
  }
  // phone_exists, validation_failed, anything unrecognized.
  return "send_failed";
}

export function messageForSendKind(kind: PhoneAuthErrorKind): string {
  if (kind === "rate_limited") return PHONE_MESSAGES.rateLimited;
  if (kind === "provider_unavailable") return PHONE_MESSAGES.unavailable;
  return PHONE_MESSAGES.sendFailed;
}
