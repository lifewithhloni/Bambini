/**
 * Pure — the All/Needs action/Active/Completed filter tabs shown on
 * /sell/orders. "Needs action" mirrors getNextSellerOrderAction()'s own
 * criteria for a genuinely seller-owed step (never a step that's on the
 * buyer, like an online payment still pending) — kept as a separate
 * concept from that function rather than deriving one from the other,
 * since a filter bucket and a single-line CTA label are different jobs
 * even though they read the same signals.
 */
export type SellerOrderFilter = "all" | "needs_action" | "active" | "completed";

const ACTIVE_STATUSES = new Set(["pending_payment", "confirmed", "ready_for_collection", "awaiting_delivery", "in_transit", "disputed"]);
const COMPLETED_STATUSES = new Set(["completed", "cancelled", "refunded"]);

export function sellerOrderNeedsAction(input: { status: string; paymentMethod: string; fulfilmentType: string; hasActiveDispute: boolean }): boolean {
  if (input.hasActiveDispute) return true;
  if (input.paymentMethod === "cash" && input.status === "pending_payment") return true;
  if (input.fulfilmentType === "collection" && input.status === "confirmed") return true;
  return false;
}

export function sellerOrderMatchesFilter(
  order: { status: string; paymentMethod: string; fulfilmentType: string; hasActiveDispute: boolean },
  filter: SellerOrderFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "needs_action") return sellerOrderNeedsAction(order);
  if (filter === "active") return ACTIVE_STATUSES.has(order.status);
  return COMPLETED_STATUSES.has(order.status);
}
