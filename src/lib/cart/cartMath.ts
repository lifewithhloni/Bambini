/**
 * Pure — no I/O, no component rendering — so this is testable within
 * the project's existing plain-node vitest setup (see Phase 10's own
 * report for why no jsdom/component-rendering framework exists here).
 * Only ever sums lines that are still genuinely purchasable right now
 * (status = "available"); a sold/unavailable/own-listing/deleted line
 * was never part of what the buyer could actually check out with.
 */
export type SubtotalLine = { status: string; priceCents: number | null };

export function calculateSubtotalCents(lines: SubtotalLine[]): number {
  return lines.filter((l) => l.status === "available").reduce((sum, l) => sum + (l.priceCents ?? 0), 0);
}

export function countAvailable(lines: SubtotalLine[]): number {
  return lines.filter((l) => l.status === "available").length;
}
