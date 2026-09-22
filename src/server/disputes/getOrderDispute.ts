import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OrderDispute = {
  id: string;
  orderId: string;
  raisedBy: string;
  reason: string;
  description: string | null;
  status: string;
  sellerResponse: string | null;
  sellerRespondedAt: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/**
 * The most recent dispute for a given order, if any — relies entirely
 * on disputes_select_participant_or_admin RLS (raised_by, any order
 * participant including is_business_member(), or admin), the same
 * not-found-vs-not-yours privacy pattern getOrder() already uses: an
 * order this caller can't see returns no dispute here either, never an
 * error. "Most recent" rather than "the active one" because a resolved
 * dispute's outcome is still worth showing on the order page even after
 * it's closed — an order can only ever have one truly ACTIVE
 * (open/under_review) dispute at a time (see
 * disputes_order_id_active_unique), but its full history isn't hidden
 * once that dispute is resolved/closed.
 */
export async function getOrderDispute(orderId: string): Promise<OrderDispute | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("disputes")
    .select("id, order_id, raised_by, reason, description, status, seller_response, seller_responded_at, resolution_notes, resolved_at, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    orderId: data.order_id,
    raisedBy: data.raised_by,
    reason: data.reason,
    description: data.description,
    status: data.status,
    sellerResponse: data.seller_response,
    sellerRespondedAt: data.seller_responded_at,
    resolutionNotes: data.resolution_notes,
    resolvedAt: data.resolved_at,
    createdAt: data.created_at,
  };
}
