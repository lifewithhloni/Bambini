/**
 * South African mobile-number normalization — pure, no I/O, no logging.
 *
 * Bambini's launch supports SOUTH AFRICAN MOBILE numbers only, stored and
 * sent to Supabase Auth in canonical E.164 form ("+27821234567").
 *
 * This module never logs, throws on, or echoes its input: the rejection
 * reason is a coarse code, never the offending value.
 *
 * ── The mobile prefix rule (documented, not guessed) ──────────────────
 * The repository had no prior phone-validation convention, so the rule is
 * taken from Google's libphonenumber metadata for ZA (as shipped in
 * libphonenumber-js 1.13.14, `countries.ZA` "mobile" pattern), reduced to
 * its general 9-digit national-number blocks:
 *
 *     national significant number (9 digits, no trunk "0"):
 *       6xx xxxxxx   -> local 060–069
 *       7xx xxxxxx   -> local 070–079
 *       8[1-5] xxxxxxx -> local 081–085
 *
 * Deliberately EXCLUDED (not mobile in that metadata, or special-use):
 *   - 080  toll-free          - 086  shared-cost / premium (0860–0869)
 *   - 087  VoIP / personal numbering (a few tiny 087 sub-blocks are
 *          mobile in libphonenumber; rejected here to stay conservative)
 *   - 01–05 geographic landlines (and 050x special blocks)
 *   - 09x  non-geographic
 *
 * This is a SYNTAX/RANGE gate, not proof a number is allocated or
 * reachable — ICASA allocates sub-blocks, so some accepted numbers are
 * unassigned. Reachability is proven by the SMS one-time code itself,
 * delivered and verified through Supabase Auth.
 */

export type PhoneRejectionReason = "empty" | "malformed" | "invalid_length" | "not_south_african" | "not_mobile";

export type NormalizePhoneResult = { ok: true; e164: string } | { ok: false; reason: PhoneRejectionReason };

/** Longest raw input considered at all — far above any real number with separators. */
const MAX_RAW_LENGTH = 32;

/** Digits, a single space, and the usual separators. No tabs/newlines/letters/quotes/angle brackets. */
const ALLOWED_CHARS = /^[+0-9 ().-]+$/;

/** 9-digit national significant numbers (after the country code / trunk 0) that are mobile — see header. */
const SA_MOBILE_NATIONAL = /^(?:[67]\d{8}|8[1-5]\d{7})$/;

export function normalizeSouthAfricanMobile(input: unknown): NormalizePhoneResult {
  if (typeof input !== "string") return { ok: false, reason: "malformed" };
  if (input.length > MAX_RAW_LENGTH * 4) return { ok: false, reason: "malformed" };

  // Pasted numbers often carry a non-breaking space; treat only that as ordinary whitespace.
  const raw = input.replace(/\u00A0/g, " ").trim();
  if (raw.length === 0) return { ok: false, reason: "empty" };
  if (raw.length > MAX_RAW_LENGTH) return { ok: false, reason: "malformed" };
  if (!ALLOWED_CHARS.test(raw)) return { ok: false, reason: "malformed" };

  // A "+" is only meaningful as the very first character.
  const plusCount = (raw.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !raw.startsWith("+"))) return { ok: false, reason: "malformed" };

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return { ok: false, reason: "malformed" };

  let national: string;
  if (raw.startsWith("+")) {
    if (!digits.startsWith("27")) return { ok: false, reason: "not_south_african" };
    national = digits.slice(2);
  } else if (digits.startsWith("00")) {
    if (!digits.startsWith("0027")) return { ok: false, reason: "not_south_african" };
    national = digits.slice(4);
  } else if (digits.startsWith("27")) {
    // A local number never starts with 27 (it starts with the trunk "0"), so this is the international form without "+".
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    return { ok: false, reason: "malformed" };
  }

  if (national.length !== 9) return { ok: false, reason: "invalid_length" };
  if (!SA_MOBILE_NATIONAL.test(national)) return { ok: false, reason: "not_mobile" };

  return { ok: true, e164: `+27${national}` };
}

/**
 * Supabase Auth stores a phone WITHOUT the leading "+" ("27821234567").
 * Returns the canonical E.164 form of an Auth-stored phone, or null if it
 * isn't a valid South African mobile (e.g. absent, or set by some other
 * means). Never throws.
 */
export function e164FromAuthPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const result = normalizeSouthAfricanMobile(phone.startsWith("+") ? phone : `+${phone}`);
  return result.ok ? result.e164 : null;
}

/** "+27821234567" -> "+27 82 123 4567" (display only). Anything unexpected is returned unchanged. */
export function formatPhoneForDisplay(e164: string): string {
  const m = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+27 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** The one user-facing message for every rejected number — never reveals which rule failed. */
export const INVALID_PHONE_MESSAGE = "Enter a valid South African mobile number, for example 082 123 4567.";
