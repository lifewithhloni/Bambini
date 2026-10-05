import "server-only";

/**
 * Server-only configuration for the Send SMS Hook. Plain process.env reads
 * (like src/server/phone/config.ts) so an absent value fails CLOSED at the
 * point of use instead of throwing at import time. None of these is ever
 * a NEXT_PUBLIC_ variable and none is ever logged.
 */

/** Supabase-issued Standard Webhooks secret: "v1,whsec_<base64>". */
export function getHookSecret(): string | null {
  const v = process.env.SEND_SMS_HOOK_SECRET;
  return v && v.trim() !== "" ? v.trim() : null;
}

export function getSmsMessengerCredentials(): { email: string; token: string } | null {
  const email = process.env.SMSMESSENGER_EMAIL?.trim();
  const token = process.env.SMSMESSENGER_API_TOKEN?.trim();
  return email && token ? { email, token } : null;
}

/** Key for the HMAC that turns a destination number into a throttle subject. */
export function getThrottleHashSecret(): string | null {
  const v = process.env.PHONE_THROTTLE_HASH_SECRET;
  return v && v.trim().length >= 16 ? v.trim() : null;
}

export const DEFAULT_GLOBAL_HOURLY_SMS_LIMIT = 200;

/** Emergency spend ceiling: OTP SMS sent per hour across ALL users. Optional override; invalid values fall back to the default. */
export function getGlobalHourlySmsLimit(): number {
  const n = Number(process.env.PHONE_GLOBAL_SMS_HOURLY_LIMIT);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : DEFAULT_GLOBAL_HOURLY_SMS_LIMIT;
}
