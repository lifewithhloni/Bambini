/**
 * Pure — no I/O. The seller-side counterpart to nextOrderAction.ts:
 * decides which single next-step CTA a seller order card should offer,
 * from data getSellerOrders()/getOrder() already produced. Presentation
 * only — every action it points at (accept_cash_order(),
 * confirm_collection(), ...) is independently re-authorized server-side
 * regardless of this function's output.
 */
export type NextSellerOrderActionType = "accept_cash" | "confirm_collection" | "track_delivery" | "view_issue" | "view_order";

export type NextSellerOrderAction = { type: NextSellerOrderActionType; label: string };

export function getNextSellerOrderAction(input: {
  status: string;
  paymentMethod: string;
  fulfilmentType: string;
  hasActiveDispute: boolean;
}): NextSellerOrderAction {
  // An active dispute is always the most important thing on this order
  // right now, regardless of what else is true about it.
  if (input.hasActiveDispute) {
    return { type: "view_issue", label: "View issue" };
  }

  // A cash order sitting at pending_payment is waiting on the SELLER's
  // own accept/decline decision — the one seller-side action with no
  // buyer-side equivalent.
  if (input.paymentMethod === "cash" && input.status === "pending_payment") {
    return { type: "accept_cash", label: "Accept order" };
  }

  if (input.status === "cancelled" || input.status === "completed" || input.status === "refunded") {
    return { type: "view_order", label: "View order" };
  }

  // confirm_collection() only ever applies once the order is confirmed
  // (paid or accepted) and collection is the fulfilment method.
  if (input.fulfilmentType === "collection" && input.status === "confirmed") {
    return { type: "confirm_collection", label: "Confirm collection" };
  }

  if (input.fulfilmentType === "delivery") {
    return { type: "track_delivery", label: "Track delivery" };
  }

  return { type: "view_order", label: "View order" };
}
