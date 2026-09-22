export type DeliveryMarkupResult = {
  providerCostCents: number;
  markupPercentageBps: number;
  markupAmountCents: number;
  /** provider cost + markup — what the buyer is actually quoted/charged. */
  buyerFeeCents: number;
};

/**
 * Pure function — no DB/network access — so it can be unit tested and
 * reused identically wherever a delivery quote needs pricing. Mirrors
 * calculateCommission()'s own rounding convention exactly (round half up,
 * in integer cents, basis points instead of a float percentage) for the
 * same reason: no floating-point drift, deterministic across repeated
 * calls with the same inputs. The rate is always passed in, never read
 * from "the current setting" inside this function — see
 * quoteService.ts, which reads delivery_markup_settings once per quote
 * fetch and persists the rate it used onto the quote row, so a later
 * change to the global setting can never retroactively alter an
 * already-fetched quote or the order created from it.
 */
export function calculateDeliveryMarkup(providerCostCents: number, markupPercentageBps: number): DeliveryMarkupResult {
  if (!Number.isInteger(providerCostCents) || providerCostCents < 0) {
    throw new Error("providerCostCents must be a non-negative integer (cents)");
  }
  if (!Number.isInteger(markupPercentageBps) || markupPercentageBps < 0 || markupPercentageBps > 10000) {
    throw new Error("markupPercentageBps must be an integer between 0 and 10000");
  }

  const markupAmountCents = Math.round((providerCostCents * markupPercentageBps) / 10000);

  return {
    providerCostCents,
    markupPercentageBps,
    markupAmountCents,
    buyerFeeCents: providerCostCents + markupAmountCents,
  };
}
