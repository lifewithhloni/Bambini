"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { getServerEnv } from "@/config/env";
import { getActivePaymentProvider } from "./registry";
import type { CheckoutSession } from "./types";

export type InitiatePaymentResult = { error: string } | { session: CheckoutSession };

/**
 * authenticated buyer -> load order -> verify buyer owns it -> verify
 * PENDING_PAYMENT -> load payment row -> verify payable -> load the
 * authoritative order total -> call the provider adapter -> store the
 * provider reference -> record PAYMENT_INITIATED -> return only the
 * checkout payload the browser needs. Nothing about price, commission,
 * seller, or buyer identity is ever read from the client — every value
 * used to build the provider checkout comes from this function's own
 * database reads. The DB write (attaching provider_reference,
 * recording the transaction event) happens inside
 * record_payment_attempt(), a SECURITY DEFINER function that
 * independently re-verifies ownership/status from auth.uid() — this
 * action's own checks are for a fast, clear error message, not the
 * actual security boundary.
 */
export async function initiatePayment(orderId: string): Promise<InitiatePaymentResult> {
  const user = await requireUser(`/orders/${orderId}/pay`);
  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, buyer_id, status, total_cents, currency, order_reference")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order || order.buyer_id !== user.id) {
    return { error: "Order not found." };
  }
  if (order.status !== "pending_payment") {
    return { error: "This order is not payable." };
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, status, method")
    .eq("order_id", orderId)
    .maybeSingle();

  if (paymentError || !payment) {
    return { error: "Order not found." };
  }
  // A cash order also starts out orders.status = 'pending_payment' (same
  // as online, before the seller has accepted it) — checked here as a
  // friendly error alongside record_payment_attempt()'s own authoritative
  // guard (see 20261010090000_online_payment_method_guard.sql), since
  // "cash is collection only" must never route through PayFast at all.
  if (payment.method !== "online") {
    return { error: "This order is paid by cash on collection, not online." };
  }
  if (payment.status !== "pending" && payment.status !== "failed") {
    return { error: "This order has already been paid." };
  }

  const { data: item } = await supabase
    .from("order_items")
    .select("title_snapshot")
    .eq("order_id", orderId)
    .maybeSingle();

  const siteUrl = getServerEnv().NEXT_PUBLIC_SITE_URL;

  let session: CheckoutSession;
  try {
    const provider = getActivePaymentProvider();
    session = await provider.createCheckout({
      orderId: order.id,
      amountCents: order.total_cents,
      currency: order.currency,
      returnUrl: `${siteUrl}/orders/${orderId}/return`,
      cancelUrl: `${siteUrl}/orders/${orderId}/pay?cancelled=1`,
      notifyUrl: `${siteUrl}/api/payments/payfast/webhook`,
      itemName: item?.title_snapshot ?? `Bambini order ${order.order_reference}`,
    });
  } catch {
    // Never leak provider configuration/secrets in the error surfaced
    // to the browser — see src/server/payments/providers/payfast/config.ts,
    // whose own errors can mention env var names.
    return { error: `Payment provider request failed for order ${order.order_reference}.` };
  }

  const { error: attemptError } = await supabase.rpc("record_payment_attempt", {
    p_order_id: orderId,
    p_provider_reference: session.providerReference,
  });
  if (attemptError) {
    return { error: "Could not start payment. Please try again." };
  }

  return { session };
}
