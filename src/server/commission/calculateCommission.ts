export type SellerType = "parent" | "business";

/**
 * Basis-point rates so the config table can express e.g. 12.5% without
 * floating point. 1200 bps = 12%.
 */
export const DEFAULT_COMMISSION_RATE_BPS: Record<SellerType, number> = {
  parent: 1200,
  business: 1500,
};

export type CommissionResult = {
  sellerType: SellerType;
  rateBps: number;
  baseAmountCents: number;
  commissionAmountCents: number;
  netAmountCents: number;
};

/**
 * Pure function — no DB/network access — so it can be unit tested and
 * reused identically by the checkout flow, the payout job, and the cash
 * collection confirmation flow. Rate is always passed in (never read from
 * a "current rate" global) so a historical order can be recalculated with
 * the rate that was actually applied at the time, per commission_rates
 * in the schema.
 */
export function calculateCommission(
  sellerType: SellerType,
  baseAmountCents: number,
  rateBps: number = DEFAULT_COMMISSION_RATE_BPS[sellerType],
): CommissionResult {
  if (!Number.isInteger(baseAmountCents) || baseAmountCents < 0) {
    throw new Error("baseAmountCents must be a non-negative integer (cents)");
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
    throw new Error("rateBps must be an integer between 0 and 10000");
  }

  // Round half up, in integer cents, to avoid floating-point drift.
  const commissionAmountCents = Math.round((baseAmountCents * rateBps) / 10000);
  const netAmountCents = baseAmountCents - commissionAmountCents;

  return {
    sellerType,
    rateBps,
    baseAmountCents,
    commissionAmountCents,
    netAmountCents,
  };
}
