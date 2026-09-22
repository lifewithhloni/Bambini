"use server";

import { requireUser } from "@/server/auth/requireUser";
import { fetchDeliveryQuotesForProduct, type BuyerDeliveryQuote } from "./quoteService";

export type FetchDeliveryQuotesResult = { ok: true; quotes: BuyerDeliveryQuote[] } | { ok: false; error: string };

/**
 * The checkout page's own trigger for §7 of the phase brief: fetches
 * fresh, real quotes (never hardcoded prices) the instant the buyer
 * selects "Delivery" — never on page load, so a buyer who only ever
 * looks at collection never causes a provider call or a delivery_quotes
 * write at all.
 */
export async function fetchDeliveryQuotes(productId: string): Promise<FetchDeliveryQuotesResult> {
  const user = await requireUser(`/checkout/${productId}`);
  return fetchDeliveryQuotesForProduct(user, productId);
}
