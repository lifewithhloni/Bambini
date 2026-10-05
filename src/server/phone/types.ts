/**
 * The result a phone-verification server action hands back to the client.
 * Deliberately narrow: a status, a user-safe message, and a retry delay.
 * Never carries an OTP, a raw provider error, a user id, or another
 * person's phone number.
 *
 * "verified" is only ever returned after the action has re-read the Auth
 * user server-side and seen phone_confirmed_at for the number just
 * confirmed — never merely because verifyOtp() returned without error.
 */
export type PhoneVerificationState =
  | null
  | { status: "code_sent"; message: string; retryAfterSeconds: number; at: number }
  | { status: "verified"; message: string }
  | { status: "already_verified"; message: string }
  | { status: "invalid_code"; message: string }
  | { status: "rate_limited"; message: string; retryAfterSeconds: number; at: number }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

/** Application-level limits. Supabase Auth enforces its own (config.toml [auth.sms] max_frequency, [auth.rate_limit]) underneath these. */
export const PHONE_LIMITS = {
  /** OTP length Supabase Auth issues by default. */
  otpLength: 6,
  send: { userCooldownSeconds: 60, userMax: 5, userWindowSeconds: 3600, ipMax: 20, ipWindowSeconds: 3600 },
  verify: { userMax: 5, userWindowSeconds: 900, ipMax: 30, ipWindowSeconds: 3600 },
} as const;

export const PHONE_MESSAGES = {
  unavailable: "Phone verification isn't available right now. Please try again later.",
  sendFailed: "We couldn't send a code to that number. Check it's correct and try again, or use a different number.",
  sent: "We've sent you a code by SMS.",
  invalidCode: "That code is incorrect or has expired. Check it, or request a new one.",
  noPending: "Request a new code first.",
  rateLimited: "Too many attempts. Please wait before trying again.",
  verified: "Your phone number is verified.",
  alreadyVerified: "That number is already verified on your account.",
  generic: "Something went wrong. Please try again.",
} as const;
