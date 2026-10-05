import "server-only";
import { reportOperationalFailure } from "@/lib/monitoring/reportOperationalFailure";
import { isPhoneVerificationEnabled } from "../config";
import { normalizeSouthAfricanMobile } from "../normalizePhone";
import { getHookSecret } from "./config";
import { throttleHookSend } from "./hookThrottle";
import { parseHookPayload } from "./parseHookPayload";
import { sendOtpSms } from "./smsMessenger";
import { verifySupabaseHookSignature } from "./verifyHookSignature";

/**
 * Supabase Auth "Send SMS" hook — the single place Bambini turns a code
 * Supabase Auth already generated into a text message.
 *
 * What this endpoint is NOT: it never generates, stores, checks or logs a
 * one-time code; it never touches auth.users or phone_confirmed_at (its
 * only database access is the service-role throttle RPC); a failure here
 * can only mean "no SMS", never "verified". Supabase Auth remains the sole
 * authority for OTP generation, the pending phone change, OTP verification
 * and phone_confirmed_at.
 *
 * Why it exists as a gate, not just a sender: the hook runs for EVERY OTP
 * send, including direct calls to Supabase Auth that bypass Bambini's
 * server actions (and their 15A.1 throttles). So it re-enforces, itself:
 * the PHONE_VERIFICATION_ENABLED kill switch, South-African-mobile-only
 * destinations, accounts-with-an-email-only, and its own throttles.
 *
 * Order (cheapest / least-trusting first):
 *   size cap -> signature (raw body, before parsing) -> kill switch ->
 *   parse -> destination (sms.phone, NEVER user.phone) -> throttle ->
 *   SMSMessenger -> 200 {}
 *
 * RESPONSE STATUS RULE: Supabase retries hook responses of 429 and 503
 * (up to 3 times, 2 s apart). A retry after we have handed a code to the
 * provider would text the user again — and could blow the 5 s budget — so
 * NO response from this handler is ever 429 or 503. Provider failures are
 * 500 (not retried); refusals are 400/401/403.
 *
 * Error bodies are fixed strings in Supabase's { error: { http_code,
 * message } } shape: nothing about the provider, the number, the code, the
 * configuration or the cause is ever included, and nothing in this file
 * logs. Operational failures go to monitoring with static reasons only.
 */

const MAX_BODY_BYTES = 20 * 1024; // Supabase's documented payload cap

function ok(): Response {
  return Response.json({}, { status: 200 });
}

function fail(status: 400 | 401 | 403 | 500, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status });
}

export async function handleSendSmsHook(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail(400, "Invalid request.");

  // Raw text, verified BEFORE any JSON parsing.
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return fail(400, "Invalid request.");

  const secret = getHookSecret();
  if (!secret) {
    reportOperationalFailure({ area: "phone_verification", reason: "send-sms hook secret is not configured" });
    return fail(500, "Phone verification is unavailable.");
  }
  if (!verifySupabaseHookSignature(rawBody, request.headers, secret)) return fail(401, "Unauthorized.");

  // Hard kill switch — direct Auth API calls bypass the UI/actions gate, so the hook enforces it too.
  if (!isPhoneVerificationEnabled()) return fail(403, "Phone verification is unavailable.");

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return fail(400, "Invalid request.");
  }

  const parsed = parseHookPayload(json);
  if (!parsed.ok) return fail(400, "Invalid request.");

  // Destination is sms.phone, validated by the shared 15A.1 normalizer: South African mobiles only.
  const destination = normalizeSouthAfricanMobile(parsed.payload.rawPhone);
  if (!destination.ok) return fail(400, "Invalid request.");

  const throttle = await throttleHookSend(parsed.payload.userId, destination.e164);
  if (!throttle.allowed) {
    if ("misconfigured" in throttle) {
      reportOperationalFailure({ area: "phone_verification", reason: "send-sms hook throttle secret is not configured" });
      return fail(500, "Phone verification is unavailable.");
    }
    return fail(403, "Too many requests. Please try again later.");
  }

  const sent = await sendOtpSms({ e164: destination.e164, otp: parsed.payload.otp });
  if (!sent.ok) {
    // Static reason only: the coarse failure kind, never a number, code, token or provider response.
    reportOperationalFailure({ area: "phone_verification", reason: `sms provider send failed: ${sent.kind}` });
    return fail(500, "Phone verification is unavailable.");
  }

  return ok();
}
