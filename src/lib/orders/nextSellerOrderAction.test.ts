import { describe, expect, it } from "vitest";
import { getNextSellerOrderAction } from "./nextSellerOrderAction";

const base = { status: "confirmed", paymentMethod: "online", fulfilmentType: "collection", hasActiveDispute: false };

describe("getNextSellerOrderAction", () => {
  it("an active dispute always wins, regardless of payment/fulfilment state", () => {
    expect(getNextSellerOrderAction({ ...base, status: "pending_payment", hasActiveDispute: true })).toEqual({ type: "view_issue", label: "View issue" });
  });

  it("a cash order awaiting the seller's own accept/decline shows 'Accept order'", () => {
    expect(getNextSellerOrderAction({ ...base, paymentMethod: "cash", status: "pending_payment" })).toEqual({ type: "accept_cash", label: "Accept order" });
  });

  it("an online order's own pending_payment never shows 'Accept order' — that's the buyer's step, not the seller's", () => {
    const result = getNextSellerOrderAction({ ...base, paymentMethod: "online", status: "pending_payment" });
    expect(result.type).not.toBe("accept_cash");
  });

  it("a confirmed collection order shows 'Confirm collection'", () => {
    expect(getNextSellerOrderAction({ ...base, fulfilmentType: "collection", status: "confirmed" })).toEqual({ type: "confirm_collection", label: "Confirm collection" });
  });

  it("a collection order not yet confirmed (still pending_payment, online) doesn't offer 'Confirm collection' early", () => {
    const result = getNextSellerOrderAction({ ...base, fulfilmentType: "collection", status: "pending_payment", paymentMethod: "online" });
    expect(result.type).not.toBe("confirm_collection");
  });

  it("a delivery order shows 'Track delivery'", () => {
    expect(getNextSellerOrderAction({ ...base, fulfilmentType: "delivery", status: "awaiting_delivery" })).toEqual({ type: "track_delivery", label: "Track delivery" });
  });

  it("a completed order shows 'View order', not a fulfilment-specific CTA", () => {
    expect(getNextSellerOrderAction({ ...base, status: "completed", fulfilmentType: "delivery" })).toEqual({ type: "view_order", label: "View order" });
  });

  it("a cancelled order shows 'View order'", () => {
    expect(getNextSellerOrderAction({ ...base, status: "cancelled" })).toEqual({ type: "view_order", label: "View order" });
  });
});
