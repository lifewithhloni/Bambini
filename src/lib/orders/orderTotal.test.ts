import { describe, expect, it } from "vitest";
import { calculateOrderTotal } from "./orderTotal";

describe("calculateOrderTotal", () => {
  it("collection: delivery fee is always exactly 0, total equals the product price", () => {
    expect(calculateOrderTotal({ productPriceCents: 25000, fulfilment: "collection", selectedDeliveryFeeCents: null })).toEqual({
      deliveryFeeCents: 0,
      totalCents: 25000,
    });
  });

  it("collection ignores any stray selectedDeliveryFeeCents value — collection is always R0", () => {
    expect(calculateOrderTotal({ productPriceCents: 25000, fulfilment: "collection", selectedDeliveryFeeCents: 9999 })).toEqual({
      deliveryFeeCents: 0,
      totalCents: 25000,
    });
  });

  it("delivery with no quote selected yet: total is not knowable, never silently falls back to the product price alone", () => {
    expect(calculateOrderTotal({ productPriceCents: 25000, fulfilment: "delivery", selectedDeliveryFeeCents: null })).toEqual({
      deliveryFeeCents: null,
      totalCents: null,
    });
  });

  it("delivery with a selected quote: total is product price + the quote's own fee", () => {
    expect(calculateOrderTotal({ productPriceCents: 25000, fulfilment: "delivery", selectedDeliveryFeeCents: 6000 })).toEqual({
      deliveryFeeCents: 6000,
      totalCents: 31000,
    });
  });

  it("no fulfilment chosen yet: nothing is knowable", () => {
    expect(calculateOrderTotal({ productPriceCents: 25000, fulfilment: "", selectedDeliveryFeeCents: null })).toEqual({
      deliveryFeeCents: null,
      totalCents: null,
    });
  });
});
