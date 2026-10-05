import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportOperationalFailure } from "@/lib/monitoring/reportOperationalFailure";
import { PHONE_LIMITS } from "./types";

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Application-level abuse protection for phone verification, backed by
 * public.phone_verification_throttle (service-role-only; stores a subject
 * + action + timestamp, NEVER a phone number or code — see
 * 20261016090000_phone_verification_throttle.sql). Supabase Auth's own
 * limits (config.toml [auth.sms] max_frequency, [auth.rate_limit]) sit
 * underneath these.
 *
 * FAILS CLOSED: if the throttle store can't be reached the attempt is
 * refused, because the thing being protected is SMS spend and code
 * guessing — the user just sees "try again later".
 *
 * The PER-USER throttle is authoritative: keyed on the session user's id,
 * always applied, and the only one that carries the resend cooldown. The
 * per-IP throttle is a SECONDARY abuse control. It reads x-forwarded-for
 * (first entry), which is trustworthy on Vercel (the platform sets it) but
 * spoofable behind a proxy that lets a client prepend its own value — which
 * is acceptable precisely because the per-user limit still holds. When no IP
 * is present only the IP limit is skipped. Shared NAT/carrier IPs make the
 * IP limits deliberately generous.
 */

type Action = "send" | "verify";

async function hit(
  subject: string,
  action: Action,
  max: number,
  windowSeconds: number,
  cooldownSeconds: number,
  record: boolean,
): Promise<ThrottleDecision> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("phone_throttle_hit", {
      p_subject: subject,
      p_action: action,
      p_max: max,
      p_window_seconds: windowSeconds,
      p_cooldown_seconds: cooldownSeconds,
      p_record: record,
    });
    const row = data?.[0];
    if (error || !row) throw new Error("throttle rpc failed");
    return row.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: Math.max(1, row.retry_after_seconds) };
  } catch {
    reportOperationalFailure({ area: "phone_verification", reason: "phone throttle store unavailable — failing closed" });
    return { allowed: false, retryAfterSeconds: 60 };
  }
}

/** One-way, truncated hash — the table never holds a raw IP address. */
async function ipSubject(): Promise<string | null> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
    if (!ip) return null;
    return `ip:${createHash("sha256").update(`bambini-phone-throttle:${ip}`).digest("hex").slice(0, 32)}`;
  } catch {
    return null;
  }
}

/** Per-user (with resend cooldown) then per-IP. Records the attempt when allowed. */
export async function throttleSend(userId: string): Promise<ThrottleDecision> {
  const l = PHONE_LIMITS.send;
  const user = await hit(`user:${userId}`, "send", l.userMax, l.userWindowSeconds, l.userCooldownSeconds, true);
  if (!user.allowed) return user;
  const ip = await ipSubject();
  return ip ? hit(ip, "send", l.ipMax, l.ipWindowSeconds, 0, true) : user;
}

/** Counts every code-check attempt (not just failures) so parallel guesses can't race the limit. */
export async function throttleVerify(userId: string): Promise<ThrottleDecision> {
  const l = PHONE_LIMITS.verify;
  const user = await hit(`user:${userId}`, "verify", l.userMax, l.userWindowSeconds, 0, true);
  if (!user.allowed) return user;
  const ip = await ipSubject();
  return ip ? hit(ip, "verify", l.ipMax, l.ipWindowSeconds, 0, true) : user;
}

/** Read-only: how long until this user may request another code (0 = now). Never consumes an attempt. */
export async function peekSendCooldownSeconds(userId: string): Promise<number> {
  const l = PHONE_LIMITS.send;
  const d = await hit(`user:${userId}`, "send", l.userMax, l.userWindowSeconds, l.userCooldownSeconds, false);
  return d.allowed ? 0 : d.retryAfterSeconds;
}

/**
 * Generic single-bucket check (records the attempt when allowed) for
 * callers that manage their own subject namespace — used by the Send SMS
 * Hook (hook/hookThrottle.ts). Same store, same fail-closed behaviour.
 */
export async function throttleSubject(subject: string, max: number, windowSeconds: number): Promise<ThrottleDecision> {
  return hit(subject, "send", max, windowSeconds, 0, true);
}

/** After a SUCCESSFUL verification: forget the user's failed attempts. Best-effort. */
export async function resetVerifyThrottle(userId: string): Promise<void> {
  try {
    await createAdminClient().rpc("phone_throttle_reset", { p_subject: `user:${userId}`, p_action: "verify" });
  } catch {
    // Not security-relevant: a leftover counter only makes the next attempt stricter.
  }
}
