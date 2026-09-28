import { describe, expect, it } from "vitest";
import { sellerOrderMatchesFilter, sellerOrderNeedsAction } from "./sellerOrderBucket";

const base = { status: "confirmed", paymentMethod: "online", fulfilmentType: "delivery", hasActiveDispute: false };

describe("sellerOrderNeedsAction", () => {
  it("true when there's an active dispute", () => {
    expect(sellerOrderNeedsAction({ ...base, hasActiveDispute: true })).toBe(true);
  });

  it("true for a cash order awaiting accept/decline", () => {
    expect(sellerOrderNeedsAction({ ...base, paymentMethod: "cash", status: "pending_payment" })).toBe(true);
  });

  it("true for a confirmed collection order awaiting the collection code", () => {
    expect(sellerOrderNeedsAction({ ...base, fulfilmentType: "collection", status: "confirmed" })).toBe(true);
  });

  it("false for an ordinary in-progress delivery order", () => {
    expect(sellerOrderNeedsAction({ ...base, status: "awaiting_delivery" })).toBe(false);
  });

  it("false for a completed order", () => {
    expect(sellerOrderNeedsAction({ ...base, status: "completed" })).toBe(false);
  });
});

describe("sellerOrderMatchesFilter", () => {
  it("'all' matches everything", () => {
    expect(sellerOrderMatchesFilter(base, "all")).toBe(true);
  });

  it("'needs_action' matches only orders needing seller action", () => {
    expect(sellerOrderMatchesFilter({ ...base, paymentMethod: "cash", status: "pending_payment" }, "needs_action")).toBe(true);
    expect(sellerOrderMatchesFilter(base, "needs_action")).toBe(false);
  });

  it("'active' matches in-progress statuses", () => {
    expect(sellerOrderMatchesFilter({ ...base, status: "in_transit" }, "active")).toBe(true);
    expect(sellerOrderMatchesFilter({ ...base, status: "completed" }, "active")).toBe(false);
  });

  it("'completed' matches completed/cancelled/refunded", () => {
    expect(sellerOrderMatchesFilter({ ...base, status: "completed" }, "completed")).toBe(true);
    expect(sellerOrderMatchesFilter({ ...base, status: "cancelled" }, "completed")).toBe(true);
    expect(sellerOrderMatchesFilter({ ...base, status: "confirmed" }, "completed")).toBe(false);
  });
});
