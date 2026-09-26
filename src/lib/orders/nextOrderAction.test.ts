import { describe, expect, it } from "vitest";
import { getNextOrderAction } from "./nextOrderAction";

const base = { status: "confirmed", paymentStatus: "paid", paymentMethod: "online", fulfilmentType: "collection", hasActiveDispute: false };

describe("getNextOrderAction", () => {
  it("an active dispute always wins, regardless of payment/fulfilment state", () => {
    expect(getNextOrderAction({ ...base, paymentStatus: "pending", hasActiveDispute: true })).toEqual({ type: "view_issue", label: "View issue" });
  });

  it("a pending online payment shows 'Continue payment'", () => {
    expect(getNextOrderAction({ ...base, paymentStatus: "pending" })).toEqual({ type: "continue_payment", label: "Continue payment" });
  });

  it("a failed online payment shows 'Try payment again', distinct from a first-time pending payment", () => {
    expect(getNextOrderAction({ ...base, paymentStatus: "failed" })).toEqual({ type: "retry_payment", label: "Try payment again" });
  });

  it("a cash order's own pending payment status never shows a payment CTA — the buyer owes no action, the seller does", () => {
    const result = getNextOrderAction({ ...base, paymentMethod: "cash", paymentStatus: "pending", status: "pending_payment" });
    expect(result.type).not.toBe("continue_payment");
    expect(result.type).not.toBe("retry_payment");
  });

  it("a paid collection order shows 'View collection details'", () => {
    expect(getNextOrderAction({ ...base, fulfilmentType: "collection" })).toEqual({ type: "view_collection", label: "View collection details" });
  });

  it("a paid delivery order shows 'Track order'", () => {
    expect(getNextOrderAction({ ...base, fulfilmentType: "delivery" })).toEqual({ type: "track_delivery", label: "Track order" });
  });

  it("a completed order shows 'View order', not a collection/delivery CTA", () => {
    expect(getNextOrderAction({ ...base, status: "completed", fulfilmentType: "delivery" })).toEqual({ type: "view_order", label: "View order" });
  });

  it("a cancelled order shows 'View order'", () => {
    expect(getNextOrderAction({ ...base, status: "cancelled" })).toEqual({ type: "view_order", label: "View order" });
  });

  it("a refunded order shows 'View order'", () => {
    expect(getNextOrderAction({ ...base, status: "refunded" })).toEqual({ type: "view_order", label: "View order" });
  });
});
