/**
 * South African ID number format + checksum validation. This is a
 * client/server-side data-entry aid only — it catches typos before a
 * submission ever reaches the database (which separately enforces the
 * 13-digit format itself via a CHECK constraint). Passing this check
 * does NOT mean the person's identity is verified; the only thing that
 * ever means that is an admin's manual review via
 * review_identity_verification() — see
 * supabase/migrations/20260928090000_identity_account_verification.sql.
 *
 * The checksum is the standard, publicly documented Luhn (mod 10)
 * algorithm South African ID numbers actually use — not an invented
 * scheme.
 */
export type IdNumberValidationResult = { ok: true } | { ok: false; error: string };

export function isThirteenDigits(value: string): boolean {
  return /^\d{13}$/.test(value);
}

function luhnChecksumValid(id: string): boolean {
  let oddSum = 0;
  for (let i = 0; i < 12; i += 2) oddSum += Number(id[i]);

  let evenDigits = "";
  for (let i = 1; i < 12; i += 2) evenDigits += id[i];
  const doubled = String(Number(evenDigits) * 2);

  let evenSum = 0;
  for (const ch of doubled) evenSum += Number(ch);

  const checkDigit = (10 - ((oddSum + evenSum) % 10)) % 10;
  return checkDigit === Number(id[12]);
}

export function validateSaIdNumber(value: string): IdNumberValidationResult {
  const trimmed = value.trim();
  if (!isThirteenDigits(trimmed)) {
    return { ok: false, error: "Enter your 13-digit South African ID number." };
  }
  if (!luhnChecksumValid(trimmed)) {
    return { ok: false, error: "That doesn't look like a valid South African ID number. Please check and try again." };
  }
  return { ok: true };
}

/** Last-4-digits display only — never the full number outside the owner's own view. */
export function maskIdNumber(value: string): string {
  if (value.length < 4) return "••••";
  return `•••••••••${value.slice(-4)}`;
}
