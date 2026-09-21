"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { fulfilmentTypeSchema } from "./validation";

export type CreateOrderState = { error: string } | null;

/**
 * Every value that actually matters financially — price, commission
 * rate/amount, seller identity, buyer identity, totals — is resolved
 * entirely inside create_order() (see
 * supabase/migrations/20260925090000_orders_checkout.sql) from the
 * product row and auth.uid(), never from this form. The only thing this
 * action actually sends the database is a product id (from the route,
 * not a form field) and the buyer's chosen fulfilment method — which the
 * function independently re-validates against the listing's own
 * collection_available/delivery_available before creating anything.
 */
export async function createOrder(
  productId: string,
  _prev: CreateOrderState,
  formData: FormData,
): Promise<CreateOrderState> {
  await requireUser(`/checkout/${productId}`);

  const parsed = fulfilmentTypeSchema.safeParse(formData.get("fulfilmentType"));
  if (!parsed.success) {
    return { error: "Choose collection or delivery." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_product_id: productId,
    p_fulfilment_type: parsed.data,
  });

  if (error || !data || data.length === 0) {
    return { error: humanizeOrderError(error?.message) };
  }

  // Phase 4B: the order now needs to actually be paid before it's
  // "done" — /orders/[orderId]/pay is the new next step, not the final
  // order-details page (still reachable afterwards via
  // /account/orders/[orderId]).
  redirect(`/orders/${data[0].order_id}/pay`);
}

/** create_order()'s own exception messages are safe to show as-is (see the migration — none of them ever include another user's data), but they're written for an SQL log reader, not a buyer, so the common ones get a friendlier rewording here. Anything unrecognized falls back to a generic message rather than surfacing raw Postgres error text. */
function humanizeOrderError(message?: string): string {
  if (!message) return "Could not place your order. Please try again.";
  if (/not available/i.test(message)) return "Sorry, this listing is no longer available.";
  if (/own listing/i.test(message)) return "You can't buy your own listing.";
  if (/collection is not available/i.test(message)) return "Collection isn't available for this listing.";
  if (/delivery is not available/i.test(message)) return "Delivery isn't available for this listing.";
  if (/delivery location/i.test(message)) return "Set your delivery location before checking out with delivery.";
  if (/payment processing is not currently available/i.test(message)) return "Checkout isn't available right now. Please try again shortly.";
  return "Could not place your order. Please try again.";
}
