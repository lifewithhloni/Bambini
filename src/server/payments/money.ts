/**
 * The one authoritative cents <-> provider-decimal conversion. PayFast
 * (and most hosted-checkout providers) expect a plain two-decimal ZAR
 * string ("499.99"), never integer cents — every provider adapter
 * converts through these two functions rather than doing its own
 * arithmetic, so there's exactly one place division/multiplication by
 * 100 can go wrong. Both directions do the conversion with integer
 * arithmetic only (string manipulation / BigInt-safe integer math),
 * never floating point, for the same reason price.ts's
 * parseRandToCents()/formatCentsAsRand() do.
 */

/** 49999 -> "499.99". Throws on a non-integer or negative input — a bad cents value here is a bug upstream, not something to silently coerce. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`centsToDecimalString: cents must be a non-negative integer, got ${cents}`);
  }
  const whole = Math.trunc(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

/**
 * "499.99" -> 49999. Returns null (never throws) for anything that isn't
 * a plain non-negative amount with at most two decimal places — a
 * provider payload is untrusted input, and the caller decides how to
 * treat an unparseable amount (typically: reject the event).
 */
export function decimalStringToCents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;

  const [, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
