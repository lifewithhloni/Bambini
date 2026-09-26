/**
 * Pure — the All/Active/Completed split shown as filter tabs on
 * /account/orders. Buckets only from order_status values that actually
 * exist in the schema (see OrderStatusBadge.tsx's own label map) —
 * never a status this function doesn't recognize is silently dropped
 * from "All" (falling into neither set below just means it's excluded
 * from Active/Completed but still shown under "All").
 */
export type OrderFilter = "all" | "active" | "completed";

const ACTIVE_STATUSES = new Set(["pending_payment", "confirmed", "ready_for_collection", "awaiting_delivery", "in_transit", "disputed"]);
const COMPLETED_STATUSES = new Set(["completed", "cancelled", "refunded"]);

export function orderMatchesFilter(status: string, filter: OrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE_STATUSES.has(status);
  return COMPLETED_STATUSES.has(status);
}
