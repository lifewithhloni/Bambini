/**
 * Parses a Rand amount typed into a form ("250", "250.50", "R 250,50")
 * into integer cents. Returns null for anything that isn't a plain
 * non-negative amount with at most 2 decimal places — the caller decides
 * how to surface that as a validation error. Never uses floating-point
 * arithmetic on the amount itself, to avoid the classic 19.99 -> 1998.9999...9
 * rounding trap.
 */
export function parseRandToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^R\s*/i, "").replace(/,/g, ".").replace(/\s/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** The inverse, for displaying a price_cents value back as an editable Rand amount ("250.50"). */
export function centsToRandInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** For display ("R 250.50"). */
export function formatCentsAsRand(cents: number): string {
  return `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
