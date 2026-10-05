import "server-only";
import { getSmsMessengerCredentials } from "./config";

/**
 * Minimal SMSMessenger REST adapter — transport only. It carries a code
 * Supabase Auth already generated; it never generates, stores or checks
 * one, and it has no access to auth.users.
 *
 * Endpoint/auth per SMSMessenger's REST docs: POST /sms/send.json with the
 * account `email` and `token` as request headers, JSON body
 * { recipientNumber: "27821234567", message }. Success is
 * { "messageId": "...", "error": null }.
 *
 * Success is NOT "any HTTP 2xx": the response must be OK, be JSON, carry a
 * messageId, and carry no error. Anything else (including an unparseable
 * body, a missing id, a provider-reported error, a network failure or the
 * 3-second timeout) is a failure — the hook must never claim a text was
 * sent when it wasn't.
 *
 * `campaign`/`dataField` are deliberately NOT sent: SMSMessenger echoes
 * them in delivery reports and shows them in its dashboard, and nothing
 * sensitive (OTP, phone) may end up there.
 *
 * Never logs: the request body, the OTP, the number, the credentials, or
 * the provider's response body. Failures are reported to callers only as
 * a coarse kind.
 */

export const SMSMESSENGER_SEND_URL = "https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json";
/** Leaves ~2s of Supabase's 5s hook budget for signature check, throttle RPCs and the response. */
export const SMSMESSENGER_TIMEOUT_MS = 3000;

export type SendSmsFailureKind = "not_configured" | "timeout" | "network" | "http_error" | "malformed_response" | "provider_error";
export type SendSmsResult = { ok: true } | { ok: false; kind: SendSmsFailureKind };

/** Canonical "+27821234567" -> the provider's "27821234567" (no plus, no trunk zero). */
export function toProviderNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}

export function buildOtpMessage(otp: string): string {
  return `Your Bambini verification code is ${otp}`;
}

export async function sendOtpSms(input: { e164: string; otp: string }): Promise<SendSmsResult> {
  const credentials = getSmsMessengerCredentials();
  if (!credentials) return { ok: false, kind: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMSMESSENGER_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(SMSMESSENGER_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", email: credentials.email, token: credentials.token },
        body: JSON.stringify({ recipientNumber: toProviderNumber(input.e164), message: buildOtpMessage(input.otp) }),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch (e) {
      return { ok: false, kind: e instanceof Error && e.name === "AbortError" ? "timeout" : "network" };
    }

    if (!response.ok) return { ok: false, kind: "http_error" };

    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      return { ok: false, kind: e instanceof Error && e.name === "AbortError" ? "timeout" : "malformed_response" };
    }
    if (typeof body !== "object" || body === null) return { ok: false, kind: "malformed_response" };

    const { messageId, error } = body as { messageId?: unknown; error?: unknown };
    if (error !== null && error !== undefined) return { ok: false, kind: "provider_error" };
    const hasId = (typeof messageId === "string" && messageId.trim() !== "") || (typeof messageId === "number" && Number.isFinite(messageId));
    if (!hasId) return { ok: false, kind: "malformed_response" };

    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
