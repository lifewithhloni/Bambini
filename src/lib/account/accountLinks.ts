/**
 * The account hub's outbound links, in one place so where each entry
 * point leads is explicit and testable. Personal selling lives at /sell,
 * buyer orders at /account/orders, and each business at its own
 * /account/business/[id] — the hub links out to those existing areas and
 * never duplicates or merges them. Deliberately contains nothing for
 * messages or notifications: no application-level backend exists for
 * either yet, so the account experience doesn't pretend. Saved items are
 * real (product_favourites, Phase 14A) and live at /account/saved.
 */
export const SELLER_LINKS = {
  sell: "/sell",
  newListing: "/sell/new",
  listings: "/sell/listings",
  orders: "/sell/orders",
  payouts: "/sell/payouts",
} as const;

export const BUYER_ORDERS_HREF = "/account/orders";
export const SAVED_HREF = "/account/saved";
export const VERIFICATION_HREF = "/account/verification";
export const LOCATION_HREF = "/account/location";
export const BUSINESSES_HREF = "/account/business";

export function businessHref(businessId: string): string {
  return `/account/business/${businessId}`;
}
