import "server-only";
import { getOrder, type OrderDetail } from "./getOrder";

/**
 * The business-scoped order detail read: getOrder() (the one existing
 * order read — RLS-scoped to participants) narrowed to an order that
 * genuinely belongs to THIS business. The businessId here comes from a
 * route the page has already authorized via requireBusinessAccess(); it is
 * never trusted on its own — the order's own business_id, read from the
 * database, must equal it, so a valid business id paired with another
 * business's (or a personal seller's) order id returns null, exactly like
 * an order that doesn't exist.
 */
export async function getBusinessOrderDetail(businessId: string, orderId: string): Promise<OrderDetail | null> {
  const order = await getOrder(orderId);
  if (!order || order.business_id !== businessId) return null;
  return order;
}
