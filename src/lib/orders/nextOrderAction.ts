/**
 * Pure — no I/O. Decides which single next-step CTA an orders-list card
 * (or the order detail page) should offer, from data the server already
 * produced (getMyOrders()/getOrder()) — never a fabricated status. This
 * only decides what to SHOW; every action it points at (continue
 * payment, open a dispute, ...) is independently re-authorized
 * server-side regardless of this function's output.
 */
export type NextOrderActionType = "continue_payment" | "retry_payment" | "view_collection" | "track_delivery" | "view_issue" | "view_order";

export type NextOrderAction = { type: NextOrderActionType; label: string };

export function getNextOrderAction(input: {
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  fulfilmentType: string;
  hasActiveDispute: boolean;
}): NextOrderAction {
  // An active dispute is always the most important thing on this order
  // right now, regardless of what else is true about it.
  if (input.hasActiveDispute) {
    return { type: "view_issue", label: "View issue" };
  }

  // Only an online payment ever needs a "continue paying" CTA — a cash
  // order's own pending_payment state means "waiting for the seller to
  // accept," never "the buyer owes an action here."
  if (input.paymentMethod === "online" && input.paymentStatus === "failed") {
    return { type: "retry_payment", label: "Try payment again" };
  }
  if (input.paymentMethod === "online" && input.paymentStatus === "pending") {
    return { type: "continue_payment", label: "Continue payment" };
  }

  if (input.status === "cancelled" || input.status === "completed" || input.status === "refunded") {
    return { type: "view_order", label: "View order" };
  }

  if (input.fulfilmentType === "delivery") {
    return { type: "track_delivery", label: "Track order" };
  }
  if (input.fulfilmentType === "collection") {
    return { type: "view_collection", label: "View collection details" };
  }

  return { type: "view_order", label: "View order" };
}
