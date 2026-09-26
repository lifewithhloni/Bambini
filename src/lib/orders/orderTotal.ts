/**
 * Pure — no I/O — so this is unit-testable and safe to import from a
 * "use client" component (PlaceOrderForm). This never invents a price:
 * productPriceCents and selectedDeliveryFeeCents both always come from
 * data the server has already produced (getCheckoutListing()'s product
 * row, and a delivery_quotes row returned by fetchDeliveryQuotes()) —
 * this only adds two already-authoritative numbers together for
 * display. create_order() independently re-derives the real total
 * server-side regardless of what this computes (see
 * 20261002090000_delivery_markup.sql) — this is presentation only, the
 * same role CartSummary's calculateSubtotalCents() already plays.
 */
export type OrderTotalInput = {
  productPriceCents: number;
  fulfilment: "collection" | "delivery" | "";
  /** null = delivery is selected but no quote has been chosen/loaded yet — the total isn't knowable yet, and this must never fall back to "just the product price" in that state (that would silently understate a delivery order's real cost). */
  selectedDeliveryFeeCents: number | null;
};

export type OrderTotal = {
  /** null = not yet known. 0 for collection. The quote's own price for delivery. */
  deliveryFeeCents: number | null;
  /** null = not yet computable (no fulfilment chosen, or delivery with no quote yet). */
  totalCents: number | null;
};

export function calculateOrderTotal({ productPriceCents, fulfilment, selectedDeliveryFeeCents }: OrderTotalInput): OrderTotal {
  if (fulfilment === "collection") {
    return { deliveryFeeCents: 0, totalCents: productPriceCents };
  }
  if (fulfilment === "delivery") {
    if (selectedDeliveryFeeCents === null) {
      return { deliveryFeeCents: null, totalCents: null };
    }
    return { deliveryFeeCents: selectedDeliveryFeeCents, totalCents: productPriceCents + selectedDeliveryFeeCents };
  }
  return { deliveryFeeCents: null, totalCents: null };
}
