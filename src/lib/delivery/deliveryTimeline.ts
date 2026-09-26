/**
 * Pure — no I/O. Builds a simple buyer-facing milestone list from the
 * CURRENT delivery_order_status only (getDeliveryTracking() exposes no
 * per-step timestamps, so this never fabricates dates — a step is only
 * ever "done" or "upcoming", nothing more specific). "pending" (booking
 * not yet confirmed) marks nothing done; "failed"/"cancelled" are
 * terminal negative outcomes, shown by the caller as their own state
 * rather than a step in this positive progression, so this returns an
 * empty list for them.
 */
export type DeliveryOrderStatus = "pending" | "booked" | "collected_by_courier" | "in_transit" | "delivered" | "failed" | "cancelled";

export type DeliveryTimelineStep = { key: DeliveryOrderStatus; label: string; done: boolean };

const POSITIVE_SEQUENCE: { key: DeliveryOrderStatus; label: string }[] = [
  { key: "booked", label: "Booking confirmed" },
  { key: "collected_by_courier", label: "Courier collected" },
  { key: "in_transit", label: "On the way" },
  { key: "delivered", label: "Delivered" },
];

// Accepts a plain string (getOrder()'s own OrderDetail type carries
// deliveryTracking.status loosely typed, not the DB enum) rather than
// requiring a cast at every call site — an unrecognized value is treated
// the same as a terminal one: nothing to show, not a guess.
export function buildDeliveryTimeline(status: string): DeliveryTimelineStep[] {
  if (status === "failed" || status === "cancelled") return [];

  const currentIndex = POSITIVE_SEQUENCE.findIndex((s) => s.key === status);
  if (currentIndex < 0 && status !== "pending") return [];

  return POSITIVE_SEQUENCE.map((step, i) => ({
    ...step,
    done: currentIndex >= 0 && i <= currentIndex,
  }));
}
