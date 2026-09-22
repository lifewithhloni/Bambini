import { describe, expect, it } from "vitest";
import { MockDeliveryProvider } from "./mock";

const capeTown = { latitude: -33.9249, longitude: 18.4241 };
const nearbySuburb = { latitude: -33.95, longitude: 18.45 };

describe("MockDeliveryProvider", () => {
  it("returns cheapest, standard, and express tiers priced in that order", async () => {
    const provider = new MockDeliveryProvider();
    const quotes = await provider.getQuotes({ pickup: capeTown, dropoff: nearbySuburb });

    const byLevel = Object.fromEntries(quotes.map((q) => [q.serviceLevel, q]));
    expect(byLevel.cheapest.priceCents).toBeLessThan(byLevel.standard.priceCents);
    expect(byLevel.standard.priceCents).toBeLessThan(byLevel.express.priceCents);
    expect(byLevel.express.etaMaxMinutes).toBeLessThan(byLevel.cheapest.etaMinMinutes);
  });

  it("books a quote and reports its status", async () => {
    const provider = new MockDeliveryProvider();
    const booked = await provider.bookDelivery({
      providerQuoteRef: "quote-1",
      pickup: capeTown,
      dropoff: nearbySuburb,
      orderId: "order-1",
      idempotencyKey: "delivery-order-1",
    });
    expect(booked.status).toBe("booked");
    await expect(provider.getStatus(booked.providerTrackingRef)).resolves.toBe("booked");
  });

  it("reports an unknown tracking ref as failed", async () => {
    const provider = new MockDeliveryProvider();
    await expect(provider.getStatus("unknown")).resolves.toBe("failed");
  });

  it("cancels a booked delivery and reflects the cancellation in subsequent status checks", async () => {
    const provider = new MockDeliveryProvider();
    const booked = await provider.bookDelivery({
      providerQuoteRef: "quote-2",
      pickup: capeTown,
      dropoff: nearbySuburb,
      orderId: "order-2",
      idempotencyKey: "delivery-order-2",
    });

    const cancelled = await provider.cancelDelivery(booked.providerTrackingRef);
    expect(cancelled).toEqual({ status: "cancelled", wasCancelled: true });
    await expect(provider.getStatus(booked.providerTrackingRef)).resolves.toBe("cancelled");
  });

  it("reports cancelling an unknown tracking ref as a no-op, not an error", async () => {
    const provider = new MockDeliveryProvider();
    await expect(provider.cancelDelivery("unknown")).resolves.toEqual({ status: "failed", wasCancelled: false });
  });

  it("Phase 7B: a repeated idempotencyKey returns the same booking instead of minting a new one", async () => {
    const provider = new MockDeliveryProvider();
    const first = await provider.bookDelivery({
      providerQuoteRef: "quote-3",
      pickup: capeTown,
      dropoff: nearbySuburb,
      orderId: "order-3",
      idempotencyKey: "delivery-order-3",
    });
    const second = await provider.bookDelivery({
      providerQuoteRef: "quote-3",
      pickup: capeTown,
      dropoff: nearbySuburb,
      orderId: "order-3",
      idempotencyKey: "delivery-order-3",
    });
    expect(second.providerTrackingRef).toBe(first.providerTrackingRef);
  });

  it("Phase 7B: two different idempotencyKeys produce two distinct bookings", async () => {
    const provider = new MockDeliveryProvider();
    const first = await provider.bookDelivery({
      providerQuoteRef: "quote-4",
      pickup: capeTown,
      dropoff: nearbySuburb,
      orderId: "order-4",
      idempotencyKey: "delivery-order-4a",
    });
    const second = await provider.bookDelivery({
      providerQuoteRef: "quote-4",
      pickup: capeTown,
      dropoff: nearbySuburb,
      orderId: "order-4",
      idempotencyKey: "delivery-order-4b",
    });
    expect(second.providerTrackingRef).not.toBe(first.providerTrackingRef);
  });
});
