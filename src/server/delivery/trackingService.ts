import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveDeliveryProviders } from "./registry";
import { getServerEnv } from "@/config/env";
import type { Database } from "@/types/database.types";

type DeliveryOrderStatus = Database["public"]["Enums"]["delivery_order_status"];

export type DeliveryTrackingInfo = { status: DeliveryOrderStatus; label: string };

// Buyer/seller-facing copy only — never a provider's own status string
// or raw payload. Every DB-level delivery_order_status value is
// covered, even though the mock provider today only ever actually
// produces "booked" (see bookingService.ts's own doc comment) — see the
// Phase 7A report for which of these are empirically reachable vs.
// handled-but-unexercised.
const STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  pending: "Booking pending",
  booked: "Booking confirmed",
  collected_by_courier: "Courier collected",
  in_transit: "In transit",
  delivered: "Delivered",
  failed: "Delivery failed",
  cancelled: "Delivery cancelled",
};

// A terminal delivery can never change again (sync_delivery_status()'s
// own transition guard enforces this at the database level too — see
// 20261001090000_delivery_reliability.sql) — polling one is always
// wasted work, cooldown or not.
const TERMINAL_STATUSES: ReadonlySet<DeliveryOrderStatus> = new Set(["delivered", "failed", "cancelled"]);

/**
 * Buyer/seller-safe tracking read for a delivery order (§15 of the
 * Phase 7A brief; rate-limited per Phase 7B's §G). Polling-based, as
 * instructed (no webhook architecture built yet). Polls the provider
 * live via getStatus() at most once per
 * DELIVERY_TRACKING_POLL_COOLDOWN_SECONDS — repeated page renders within
 * that window return the last-synced status straight from the database
 * without calling the provider at all. delivery_orders.last_synced_at
 * (Phase 7B) is the source of truth for "when did we last actually ask
 * the provider" — distinct from updated_at, which only changes when the
 * status itself changes. Returns only a status + a plain display label,
 * never provider credentials, a raw provider payload, or any
 * location/coordinate data. Returns null when this order has no
 * delivery_orders row yet (booking hasn't happened — e.g. payment still
 * pending) — callers should treat that as "no tracking yet", not an
 * error.
 */
export async function getDeliveryTracking(orderId: string): Promise<DeliveryTrackingInfo | null> {
  const admin = createAdminClient();

  const { data: deliveryOrder } = await admin
    .from("delivery_orders")
    .select("provider_id, provider_tracking_ref, status, last_synced_at")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!deliveryOrder) return null;

  const lastKnown = { status: deliveryOrder.status, label: STATUS_LABELS[deliveryOrder.status] };

  if (!deliveryOrder.provider_tracking_ref) return lastKnown;
  if (TERMINAL_STATUSES.has(deliveryOrder.status)) return lastKnown;

  const cooldownSeconds = getServerEnv().DELIVERY_TRACKING_POLL_COOLDOWN_SECONDS;
  if (deliveryOrder.last_synced_at) {
    const elapsedSeconds = (Date.now() - new Date(deliveryOrder.last_synced_at).getTime()) / 1000;
    if (elapsedSeconds < cooldownSeconds) return lastKnown;
  }

  const { data: providerRow } = await admin.from("delivery_providers").select("slug").eq("id", deliveryOrder.provider_id).maybeSingle();
  const provider = providerRow ? getActiveDeliveryProviders().find((p) => p.slug === providerRow.slug) : undefined;
  if (!provider) return lastKnown;

  let liveStatus: DeliveryOrderStatus;
  try {
    liveStatus = await provider.getStatus(deliveryOrder.provider_tracking_ref);
  } catch {
    // Provider unreachable — still record the attempt so a down
    // provider gets polled at most once per cooldown window too, not
    // once per page view. Falls back to the last known status either way.
    await admin.rpc("record_delivery_sync_attempt", { p_order_id: orderId });
    return lastKnown;
  }

  // Always synced on a successful poll, even when the status is
  // unchanged — sync_delivery_status() bumps last_synced_at
  // unconditionally (that's what makes the cooldown above work) and its
  // own transition guard treats old===new as a safe no-op.
  const { error } = await admin.rpc("sync_delivery_status", { p_order_id: orderId, p_status: liveStatus });
  if (error) {
    console.error(`getDeliveryTracking: sync_delivery_status failed for order ${orderId}: ${error.message}`);
    return lastKnown;
  }

  return { status: liveStatus, label: STATUS_LABELS[liveStatus] };
}
