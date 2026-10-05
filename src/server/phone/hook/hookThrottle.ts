import "server-only";
import { createHmac } from "node:crypto";
import { throttleSubject, type ThrottleDecision } from "../throttle";
import { getGlobalHourlySmsLimit, getThrottleHashSecret } from "./config";

/**
 * Hook-level send throttling. The 15A.1 action-level limits (throttle.ts:
 * throttleSend) only protect requests that go through Bambini's server
 * actions; a signed-in user can call Supabase Auth directly and skip them.
 * The Send SMS Hook runs for EVERY OTP send, so it enforces limits again
 * here, independently.
 *
 * It reuses the existing phone_verification_throttle store (same
 * service-role-only RPC, same fail-closed behaviour) with SEPARATE subject
 * namespaces so it never double-counts the action-level buckets
 * ("user:<id>" / "ip:<hash>"):
 *
 *   huser:<auth user id>      5 sends / hour
 *   dest:<HMAC of the number> 3 sends / hour   (also stops texting one
 *                                              number repeatedly, e.g.
 *                                              harassment or pumping)
 *   global:sms                N sends / hour, all users — an emergency
 *                              SPEND circuit breaker, default 200
 *                              (PHONE_GLOBAL_SMS_HOURLY_LIMIT)
 *
 * Supabase's own 60 s per-user resend gap is not duplicated here.
 *
 * Destination subjects are a KEYED HMAC-SHA256 (PHONE_THROTTLE_HASH_SECRET),
 * never the number and never a plain hash: an SA mobile number has too
 * little entropy for an unkeyed hash to be one-way. Checks run user ->
 * destination -> global so a request already refused for its own user
 * doesn't burn global budget. Any store failure refuses the send.
 */

export const HOOK_LIMITS = { userMax: 5, destMax: 3, windowSeconds: 3600 } as const;

export function hashDestination(e164: string, secret: string): string {
  return createHmac("sha256", secret).update(e164).digest("hex");
}

export type HookThrottleDecision = ThrottleDecision | { allowed: false; retryAfterSeconds: number; misconfigured: true };

export async function throttleHookSend(userId: string, e164: string): Promise<HookThrottleDecision> {
  const secret = getThrottleHashSecret();
  if (!secret) return { allowed: false, retryAfterSeconds: 60, misconfigured: true };

  const user = await throttleSubject(`huser:${userId}`, HOOK_LIMITS.userMax, HOOK_LIMITS.windowSeconds);
  if (!user.allowed) return user;

  const dest = await throttleSubject(`dest:${hashDestination(e164, secret)}`, HOOK_LIMITS.destMax, HOOK_LIMITS.windowSeconds);
  if (!dest.allowed) return dest;

  return throttleSubject("global:sms", getGlobalHourlySmsLimit(), HOOK_LIMITS.windowSeconds);
}
