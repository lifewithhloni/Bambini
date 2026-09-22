import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveDeliveryProviders } from "./registry";
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

/**
 * Buyer/seller-safe tracking read for a delivery order (§15 of the
 * phase brief) — polling-based, as instructed (no webhook architecture
 * built in this phase). Polls the provider live via getStatus(), syncs
 * a changed result into delivery_orders/orders atomically
 * (sync_delivery_status()), and returns only a status + a plain display
 * label — never provider credentials, a raw provider payload, or any
 * location/coordinate data. Returns null when this order has no
 * delivery_orders row yet (booking hasn't happened — e.g. payment still
 * pending) — callers should treat that as "no tracking yet", not an
 * error.
 */
export async function getDeliveryTracking(orderId: string): Promise<DeliveryTrackingInfo | null> {
  const admin = createAdminClient();

  const { data: deliveryOrder } = await admin
    .from("delivery_orders")
    .select("provider_id, provider_tracking_ref, status")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!deliveryOrder) return null;
  if (!deliveryOrder.provider_tracking_ref) {
    return { status: deliveryOrder.status, label: STATUS_LABELS[deliveryOrder.status] };
  }

  const { data: providerRow } = await admin.from("delivery_providers").select("slug").eq("id", deliveryOrder.provider_id).maybeSingle();
  const provider = providerRow ? getActiveDeliveryProviders().find((p) => p.slug === providerRow.slug) : undefined;
  if (!provider) {
    return { status: deliveryOrder.status, label: STATUS_LABELS[deliveryOrder.status] };
  }

  let liveStatus: DeliveryOrderStatus;
  try {
    liveStatus = await provider.getStatus(deliveryOrder.provider_tracking_ref);
  } catch {
    // Provider unreachable — show the last known status rather than fail the page.
    return { status: deliveryOrder.status, label: STATUS_LABELS[deliveryOrder.status] };
  }

  if (liveStatus === deliveryOrder.status) {
    return { status: liveStatus, label: STATUS_LABELS[liveStatus] };
  }

  const { error } = await admin.rpc("sync_delivery_status", { p_order_id: orderId, p_status: liveStatus });
  if (error) {
    console.error(`getDeliveryTracking: sync_delivery_status failed for order ${orderId}: ${error.message}`);
    return { status: deliveryOrder.status, label: STATUS_LABELS[deliveryOrder.status] };
  }

  return { status: liveStatus, label: STATUS_LABELS[liveStatus] };
}
