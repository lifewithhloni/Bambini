"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { reportOperationalFailure } from "@/lib/monitoring/reportOperationalFailure";
import { isPhoneVerificationEnabled } from "./config";
import { e164FromAuthPhone, INVALID_PHONE_MESSAGE, normalizeSouthAfricanMobile } from "./normalizePhone";
import { mapPhoneAuthError, messageForSendKind, type PhoneAuthErrorKind } from "./mapAuthError";
import { resetVerifyThrottle, throttleSend, throttleVerify } from "./throttle";
import { PHONE_LIMITS, PHONE_MESSAGES, type PhoneVerificationState } from "./types";

/**
 * Phone verification through Supabase Auth's NATIVE phone identity — no
 * OTP is generated, stored, compared or returned by Bambini:
 *
 *   start   : auth.updateUser({ phone })            -> Auth sends the SMS
 *   confirm : auth.verifyOtp({ phone, token, type: "phone_change" })
 *                                                   -> Auth sets auth.users.phone
 *                                                      + phone_confirmed_at
 *   resend  : auth.resend({ type: "phone_change", phone })
 *
 * Invariants (each has a test in actions.test.ts):
 *  - The acting user is ALWAYS requireUser()'s server-verified session
 *    user. No action accepts a user id; confirm/resend don't even accept a
 *    phone — they use the pending number Auth itself holds (user.new_phone),
 *    so a client can't point a code check at someone else's number.
 *  - The number is normalized to canonical +27 E.164 BEFORE Auth is called.
 *  - Nothing here ever sets phone_confirmed_at or writes the phone to any
 *    table. profiles.phone is not involved at all.
 *  - A verified user changing number: Auth keeps the OLD confirmed phone
 *    until the NEW one passes verifyOtp, so the new number can never be
 *    "live" without re-verification.
 *  - Raw Auth errors never reach the client (one fixed message per kind;
 *    "phone already registered" == any other send failure), and nothing in
 *    this file logs a phone number, OTP, or Auth error text.
 *  - "verified" is returned only after re-reading the Auth user and seeing
 *    phone_confirmed_at for the confirmed number.
 *  - With PHONE_VERIFICATION_ENABLED off every action refuses without
 *    calling Auth; can_transact() is unaffected either way.
 */

const PATH = "/account/verification";

function unavailable(): PhoneVerificationState {
  return { status: "unavailable", message: PHONE_MESSAGES.unavailable };
}

function rateLimited(retryAfterSeconds: number): PhoneVerificationState {
  return { status: "rate_limited", message: PHONE_MESSAGES.rateLimited, retryAfterSeconds, at: Date.now() };
}

function sendFailure(kind: PhoneAuthErrorKind): PhoneVerificationState {
  if (kind === "provider_unavailable") {
    // Static reason only — never the Auth error text, which can echo the number.
    reportOperationalFailure({ area: "phone_verification", reason: "SMS provider unavailable or phone provider disabled" });
    return unavailable();
  }
  if (kind === "rate_limited") return rateLimited(PHONE_LIMITS.send.userCooldownSeconds);
  return { status: "error", message: messageForSendKind(kind) };
}

function codeSent(): PhoneVerificationState {
  return { status: "code_sent", message: PHONE_MESSAGES.sent, retryAfterSeconds: PHONE_LIMITS.send.userCooldownSeconds, at: Date.now() };
}

export async function startPhoneVerification(_prev: PhoneVerificationState, formData: FormData): Promise<PhoneVerificationState> {
  if (!isPhoneVerificationEnabled()) return unavailable();
  const user = await requireUser(PATH);

  const normalized = normalizeSouthAfricanMobile(formData.get("phone"));
  if (!normalized.ok) return { status: "error", message: INVALID_PHONE_MESSAGE };

  if (user.phone_confirmed_at && e164FromAuthPhone(user.phone) === normalized.e164) {
    return { status: "already_verified", message: PHONE_MESSAGES.alreadyVerified };
  }

  const decision = await throttleSend(user.id);
  if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ phone: normalized.e164 });
  if (error) return sendFailure(mapPhoneAuthError(error));

  revalidatePath(PATH);
  return codeSent();
}

export async function confirmPhoneVerification(_prev: PhoneVerificationState, formData: FormData): Promise<PhoneVerificationState> {
  if (!isPhoneVerificationEnabled()) return unavailable();
  const user = await requireUser(PATH);

  const pending = e164FromAuthPhone(user.new_phone);
  if (!pending) return { status: "error", message: PHONE_MESSAGES.noPending };

  const raw = formData.get("code");
  const code = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  if (!new RegExp(`^\\d{${PHONE_LIMITS.otpLength}}$`).test(code)) {
    return { status: "invalid_code", message: PHONE_MESSAGES.invalidCode };
  }

  const decision = await throttleVerify(user.id);
  if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone: pending, token: code, type: "phone_change" });
  if (error) {
    const kind = mapPhoneAuthError(error);
    if (kind === "invalid_code" || kind === "send_failed") return { status: "invalid_code", message: PHONE_MESSAGES.invalidCode };
    return sendFailure(kind);
  }

  // Trust Auth's stored state, not the absence of an error: re-read the user.
  const {
    data: { user: fresh },
  } = await supabase.auth.getUser();
  if (!fresh || fresh.phone_confirmed_at == null || e164FromAuthPhone(fresh.phone) !== pending) {
    return { status: "error", message: PHONE_MESSAGES.generic };
  }

  await resetVerifyThrottle(user.id);
  revalidatePath(PATH);
  revalidatePath("/account");
  return { status: "verified", message: PHONE_MESSAGES.verified };
}

export async function resendPhoneVerification(_prev: PhoneVerificationState): Promise<PhoneVerificationState> {
  if (!isPhoneVerificationEnabled()) return unavailable();
  const user = await requireUser(PATH);

  const pending = e164FromAuthPhone(user.new_phone);
  if (!pending) return { status: "error", message: PHONE_MESSAGES.noPending };

  const decision = await throttleSend(user.id);
  if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "phone_change", phone: pending });
  if (error) return sendFailure(mapPhoneAuthError(error));

  revalidatePath(PATH);
  return codeSent();
}
