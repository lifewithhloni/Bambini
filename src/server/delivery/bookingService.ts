import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveDeliveryProviders } from "./registry";
import type { GeoPoint } from "./types";

/**
 * Phase 7A: books a delivery with the provider once payment has
 * confirmed. Called only from the PayFast webhook route
 * (src/app/api/payments/payfast/webhook/route.ts), only after
 * process_payfast_itn() reports a 'confirmed' or 'duplicate_ignored'
 * outcome — never before payment, never directly from the browser (§11
 * of the phase brief). A no-op for a collection order (returns
 * immediately) and a no-op if this order already has a delivery_orders
 * row (booked by an earlier call).
 *
 * 'duplicate_ignored' is a deliberate trigger here, not just
 * 'confirmed': if an earlier webhook delivery got as far as calling
 * reserve_delivery_order() + the provider, but the process crashed or
 * this function threw before record_delivery_booking() could run, the
 * *payment* is still correctly marked paid (process_payfast_itn() is
 * itself idempotent) and PayFast's own retry will arrive as
 * 'duplicate_ignored', not 'confirmed' — if this function only ran on
 * 'confirmed', that retry would never re-attempt booking, leaving a
 * paid order with no delivery ever booked. Reacting to both outcomes,
 * gated by "does a delivery_orders row already exist", is what makes a
 * PayFast retry actually retry delivery booking rather than silently
 * skip it.
 *
 * Known limitation, deliberately not solved in Phase 7A (see the phase
 * report's "before real-provider integration" section): if the process
 * is killed between reserve_delivery_order() succeeding and
 * record_delivery_booking() running (e.g. a serverless function
 * timeout), the delivery_orders row is left at 'pending' forever — the
 * unique constraint means the very next retry sees a row already exists
 * and stops, so this never becomes a duplicate booking, but it also
 * never becomes a completed one without manual intervention. A
 * reconciliation sweep for stuck 'pending' rows is real production
 * infrastructure this phase deliberately doesn't build (the brief
 * excludes "sophisticated webhook infrastructure").
 */
export async function bookDeliveryForOrder(orderId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id, fulfilment_type").eq("id", orderId).maybeSingle();
  if (!order || order.fulfilment_type !== "delivery") return;

  const { data: quote } = await admin
    .from("delivery_quotes")
    .select("id, provider_id, pickup_location_id, dropoff_location_id, provider_quote_ref")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!quote) {
    console.error(`bookDeliveryForOrder: order ${orderId} is a delivery order with no attached delivery_quotes row — cannot book.`);
    return;
  }

  const { data: deliveryOrderId, error: reserveError } = await admin.rpc("reserve_delivery_order", {
    p_order_id: orderId,
    p_quote_id: quote.id,
    p_provider_id: quote.provider_id,
  });

  if (reserveError) {
    console.error(`bookDeliveryForOrder: reserve_delivery_order() failed for order ${orderId}: ${reserveError.message}`);
    return;
  }
  if (!deliveryOrderId) {
    // Already reserved/booked by an earlier call — idempotent no-op.
    return;
  }

  // Phase 7B: re-checked here, not just trusted from create_order()'s
  // own quote-time check — the provider can be disabled in the database
  // (is_active) or removed from the code registry (DELIVERY_PROVIDERS)
  // at any point between order creation and payment confirmation, and
  // nothing until now re-verified either one at the moment that actually
  // matters: right before a real courier would be contacted. Both must
  // agree (DB row active AND a matching code-registered adapter) or
  // booking does not proceed.
  const { data: providerRow } = await admin.from("delivery_providers").select("slug, is_active").eq("id", quote.provider_id).maybeSingle();
  const provider =
    providerRow?.is_active ? getActiveDeliveryProviders().find((p) => p.slug === providerRow.slug) : undefined;

  if (!provider) {
    await admin.rpc("record_delivery_booking", { p_delivery_order_id: deliveryOrderId, p_provider_tracking_ref: null, p_status: "failed" });
    console.error(
      `bookDeliveryForOrder: no active, registered provider for order ${orderId}'s quote (provider row: ${
        providerRow?.slug ?? "none"
      }, is_active: ${providerRow?.is_active ?? "n/a"}).`,
    );
    return;
  }

  const [{ data: pickupLoc }, { data: dropoffLoc }] = await Promise.all([
    admin.from("locations").select("latitude, longitude").eq("id", quote.pickup_location_id).maybeSingle(),
    admin.from("locations").select("latitude, longitude").eq("id", quote.dropoff_location_id).maybeSingle(),
  ]);

  if (!pickupLoc || !dropoffLoc) {
    await admin.rpc("record_delivery_booking", { p_delivery_order_id: deliveryOrderId, p_provider_tracking_ref: null, p_status: "failed" });
    console.error(`bookDeliveryForOrder: could not resolve pickup/dropoff coordinates for order ${orderId}.`);
    return;
  }

  const pickup: GeoPoint = { latitude: pickupLoc.latitude, longitude: pickupLoc.longitude };
  const dropoff: GeoPoint = { latitude: dropoffLoc.latitude, longitude: dropoffLoc.longitude };

  try {
    const booked = await provider.bookDelivery({
      providerQuoteRef: quote.provider_quote_ref,
      pickup,
      dropoff,
      orderId,
      // The reservation row's own id — stable and unique per order (see
      // reserve_delivery_order()'s ON CONFLICT DO NOTHING guarantee) —
      // not a promise that any given provider treats it as idempotent;
      // see BookDeliveryRequest.idempotencyKey's own doc comment.
      idempotencyKey: deliveryOrderId,
    });

    await admin.rpc("record_delivery_booking", {
      p_delivery_order_id: deliveryOrderId,
      p_provider_tracking_ref: booked.providerTrackingRef,
      p_status: booked.status === "booked" ? "booked" : "failed",
    });
  } catch (err) {
    await admin.rpc("record_delivery_booking", { p_delivery_order_id: deliveryOrderId, p_provider_tracking_ref: null, p_status: "failed" });
    console.error(`bookDeliveryForOrder: provider.bookDelivery() threw for order ${orderId}: ${(err as Error).message}`);
  }
}
