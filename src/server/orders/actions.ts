"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { fulfilmentTypeSchema, paymentMethodSchema } from "./validation";

export type CreateOrderState = { error: string } | null;

/**
 * Every value that actually matters financially — price, commission
 * rate/amount, seller identity, buyer identity, totals — is resolved
 * entirely inside create_order() (see
 * supabase/migrations/20260925090000_orders_checkout.sql) from the
 * product row and auth.uid(), never from this form. The only things this
 * action actually sends the database are a product id (from the route,
 * not a form field) and the buyer's chosen fulfilment/payment method —
 * both independently re-validated inside the function (fulfilment
 * against the listing's own collection_available/delivery_available;
 * payment method against the global cash switch, cash-requires-
 * collection, and fresh seller eligibility — see
 * 20260927090000_cash_collection_transactions.sql) before creating
 * anything.
 */
export async function createOrder(
  productId: string,
  _prev: CreateOrderState,
  formData: FormData,
): Promise<CreateOrderState> {
  await requireUser(`/checkout/${productId}`);

  const parsedFulfilment = fulfilmentTypeSchema.safeParse(formData.get("fulfilmentType"));
  if (!parsedFulfilment.success) {
    return { error: "Choose collection or delivery." };
  }

  // Defaults to "online" so a checkout page that never rendered the cash
  // option (e.g. delivery selected, or the seller isn't cash-eligible)
  // still works with no payment-method field present at all.
  const paymentMethodRaw = formData.get("paymentMethod") ?? "online";
  const parsedPaymentMethod = paymentMethodSchema.safeParse(paymentMethodRaw);
  if (!parsedPaymentMethod.success) {
    return { error: "Choose a payment method." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_product_id: productId,
    p_fulfilment_type: parsedFulfilment.data,
    p_payment_method: parsedPaymentMethod.data,
  });

  if (error || !data || data.length === 0) {
    return { error: humanizeOrderError(error?.message) };
  }

  if (parsedPaymentMethod.data === "cash") {
    // No PayFast checkout to redirect to — the order is already
    // awaiting the seller's acceptance.
    redirect(`/account/orders/${data[0].order_id}`);
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
  if (/not available for delivery/i.test(message)) return "Cash on collection isn't available for delivery — choose collection, or pay online.";
  if (/not currently eligible to accept cash/i.test(message)) return "Cash on collection isn't available for this seller right now. Try paying online instead.";
  if (/cash payments are currently unavailable/i.test(message)) return "Cash on collection isn't available right now. Try paying online instead.";
  if (/not available/i.test(message)) return "Sorry, this listing is no longer available.";
  if (/own listing/i.test(message)) return "You can't buy your own listing.";
  if (/collection is not available/i.test(message)) return "Collection isn't available for this listing.";
  if (/delivery is not available/i.test(message)) return "Delivery isn't available for this listing.";
  if (/delivery location/i.test(message)) return "Set your delivery location before checking out with delivery.";
  if (/payment processing is not currently available/i.test(message)) return "Checkout isn't available right now. Please try again shortly.";
  return "Could not place your order. Please try again.";
}

export type CashActionState = { error: string } | null;

/** Seller accepts a pending cash order — see accept_cash_order() (SECURITY DEFINER; re-validates ownership/state/eligibility server-side, never trusts this action beyond the order id). */
export async function acceptCashOrder(orderId: string, _prev: CashActionState): Promise<CashActionState> {
  await requireUser(`/sell/orders/${orderId}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_cash_order", { p_order_id: orderId });
  if (error) return { error: humanizeCashActionError(error.message) };
  revalidatePath(`/sell/orders/${orderId}`);
  return null;
}

/** Seller declines a pending cash order — releases the listing and voids the commission obligation (see decline_cash_order()). */
export async function declineCashOrder(orderId: string, _prev: CashActionState): Promise<CashActionState> {
  await requireUser(`/sell/orders/${orderId}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_cash_order", { p_order_id: orderId });
  if (error) return { error: humanizeCashActionError(error.message) };
  revalidatePath(`/sell/orders/${orderId}`);
  return null;
}

export type ConfirmCollectionState = { error: string; outcome?: string } | { success: true; outcome: string } | null;

/**
 * Seller enters the buyer-provided code — see confirm_collection(). A
 * wrong code is not an exception, it's a normal "incorrect_code" /
 * "locked" outcome the function returns; only auth/ownership/state
 * problems raise. Never accepts or displays the raw stored code — this
 * action only ever sends a guess, never receives the true value back.
 */
export async function confirmCollection(orderId: string, _prev: ConfirmCollectionState, formData: FormData): Promise<ConfirmCollectionState> {
  await requireUser(`/sell/orders/${orderId}`);

  const code = String(formData.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return { error: "Enter the 6-digit collection code." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_collection", { p_order_id: orderId, p_code: code });
  if (error || !data || data.length === 0) {
    return { error: humanizeCashActionError(error?.message) };
  }

  const outcome = data[0].outcome;
  revalidatePath(`/sell/orders/${orderId}`);

  if (outcome === "completed" || outcome === "already_completed") {
    return { success: true, outcome };
  }
  if (outcome === "locked") {
    return { error: "Too many incorrect attempts. This collection code is now locked.", outcome };
  }
  return { error: "That code doesn't match. Please check with the buyer and try again.", outcome };
}

function humanizeCashActionError(message?: string): string {
  if (!message) return "Something went wrong. Please try again.";
  if (/not awaiting acceptance/i.test(message)) return "This order isn't awaiting acceptance anymore.";
  if (/cannot be declined/i.test(message)) return "This order can no longer be declined.";
  if (/no longer eligible/i.test(message)) return "You're no longer eligible to accept cash orders.";
  if (/cash payments are currently unavailable/i.test(message)) return "Cash on collection is currently unavailable.";
  if (/not ready for collection confirmation/i.test(message)) return "This order isn't ready for collection confirmation yet.";
  if (/not a collection order/i.test(message)) return "This isn't a collection order.";
  if (/order not found/i.test(message)) return "Order not found.";
  return "Something went wrong. Please try again.";
}
