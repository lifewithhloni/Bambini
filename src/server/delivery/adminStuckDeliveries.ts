import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type StuckPendingDelivery = {
  deliveryOrderId: string;
  orderId: string;
  orderReference: string;
  providerName: string | null;
  quoteId: string | null;
  serviceLevel: string | null;
  priceCents: number | null;
  status: string;
  providerTrackingRef: string | null;
  createdAt: string;
  updatedAt: string;
  ageMinutes: number;
};

/**
 * Phase 7B: admin-only (requireAdmin() 404s otherwise) read of
 * delivery_orders stuck at 'pending' past a threshold age — never a
 * mutation, matching this phase's own product lock (no automatic retry,
 * no automatic re-booking). list_stuck_pending_deliveries() (SECURITY
 * DEFINER, checks is_admin() internally — see
 * 20261001090000_delivery_reliability.sql) is the actual boundary; this
 * function's own requireAdmin() call is the same UI-convenience 404 gate
 * every other admin page in this codebase already uses. Deliberately
 * returns no coordinates, location ids, or raw provider payloads — only
 * what an admin needs to identify a stuck booking and know which
 * provider/tracking reference (if any) to ask about.
 */
export async function listStuckPendingDeliveries(olderThanMinutes?: number): Promise<StuckPendingDelivery[]> {
  await requireAdmin("/admin/delivery");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_stuck_pending_deliveries", {
    p_older_than_minutes: olderThanMinutes,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    deliveryOrderId: row.delivery_order_id,
    orderId: row.order_id,
    orderReference: row.order_reference,
    providerName: row.provider_name,
    quoteId: row.quote_id,
    serviceLevel: row.service_level,
    priceCents: row.price_cents,
    status: row.status,
    providerTrackingRef: row.provider_tracking_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ageMinutes: row.age_minutes,
  }));
}
