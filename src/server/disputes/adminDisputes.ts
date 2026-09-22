import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type AdminDisputeSummary = {
  id: string;
  orderId: string;
  orderReference: string;
  status: string;
  reason: string;
  buyerName: string | null;
  sellerName: string | null;
  createdAt: string;
};

/**
 * Admin-only — every dispute, optionally filtered to one status, newest
 * first. Same "RLS is the real boundary, requireAdmin() is the UI
 * convenience" split as every other admin list in this codebase;
 * disputes_select_participant_or_admin already permits an admin's own
 * session to read every row.
 */
type DisputeStatusFilter = "open" | "under_review" | "resolved_buyer" | "resolved_seller" | "resolved_partial" | "closed";

export async function listDisputes(statusFilter?: DisputeStatusFilter): Promise<AdminDisputeSummary[]> {
  await requireAdmin("/admin/disputes");
  const supabase = await createClient();

  let query = supabase
    .from("disputes")
    .select("id, order_id, status, reason, created_at")
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data: disputes, error } = await query;
  if (error || !disputes || disputes.length === 0) return [];

  const orderIds = Array.from(new Set(disputes.map((d) => d.order_id)));
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_reference, buyer_id, seller_type, seller_profile_id, business_id")
    .in("id", orderIds);

  const ordersById = new Map((orders ?? []).map((o) => [o.id, o]));
  const buyerIds = Array.from(new Set((orders ?? []).map((o) => o.buyer_id)));
  const sellerProfileIds = Array.from(new Set((orders ?? []).filter((o) => o.seller_type === "parent" && o.seller_profile_id).map((o) => o.seller_profile_id as string)));
  const businessIds = Array.from(new Set((orders ?? []).filter((o) => o.seller_type === "business" && o.business_id).map((o) => o.business_id as string)));

  const [{ data: buyers }, { data: sellers }, { data: businesses }] = await Promise.all([
    buyerIds.length > 0 ? supabase.from("profiles_public").select("id, full_name").in("id", buyerIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    sellerProfileIds.length > 0 ? supabase.from("profiles_public").select("id, full_name").in("id", sellerProfileIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    businessIds.length > 0 ? supabase.from("businesses_public").select("id, business_name").in("id", businessIds) : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
  ]);

  const buyerNameById = new Map((buyers ?? []).map((b) => [b.id, b.full_name]));
  const sellerNameById = new Map((sellers ?? []).map((s) => [s.id, s.full_name]));
  const businessNameById = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  return disputes.map((d) => {
    const order = ordersById.get(d.order_id);
    const sellerName = order
      ? order.seller_type === "parent"
        ? (sellerNameById.get(order.seller_profile_id ?? "") ?? null)
        : (businessNameById.get(order.business_id ?? "") ?? null)
      : null;
    return {
      id: d.id,
      orderId: d.order_id,
      orderReference: order?.order_reference ?? "—",
      status: d.status,
      reason: d.reason,
      buyerName: order ? (buyerNameById.get(order.buyer_id) ?? null) : null,
      sellerName,
      createdAt: d.created_at,
    };
  });
}

export type AdminDisputeDetail = {
  id: string;
  orderId: string;
  orderReference: string;
  orderStatus: string;
  reason: string;
  description: string | null;
  status: string;
  sellerResponse: string | null;
  sellerRespondedAt: string | null;
  resolutionNotes: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  buyerName: string | null;
  sellerName: string | null;
  totalCents: number;
  subtotalCents: number;
};

/** Admin-only — a single dispute with enough order/participant context to make a resolution decision, deliberately never the seller's delivery-margin/provider-cost internals (this page has no reason to show them). */
export async function getDisputeDetail(disputeId: string): Promise<AdminDisputeDetail | null> {
  await requireAdmin("/admin/disputes");
  const supabase = await createClient();

  const { data: dispute, error } = await supabase
    .from("disputes")
    .select("id, order_id, reason, description, status, seller_response, seller_responded_at, resolution_notes, resolved_by, resolved_at, created_at")
    .eq("id", disputeId)
    .maybeSingle();

  if (error || !dispute) return null;

  const { data: order } = await supabase
    .from("orders")
    .select("order_reference, status, buyer_id, seller_type, seller_profile_id, business_id, subtotal_cents, total_cents")
    .eq("id", dispute.order_id)
    .maybeSingle();

  if (!order) return null;

  const [{ data: buyer }, { data: seller }, { data: business }, { data: resolvedByProfile }] = await Promise.all([
    supabase.from("profiles_public").select("full_name").eq("id", order.buyer_id).maybeSingle(),
    order.seller_type === "parent" && order.seller_profile_id
      ? supabase.from("profiles_public").select("full_name").eq("id", order.seller_profile_id).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string } | null }),
    order.seller_type === "business" && order.business_id
      ? supabase.from("businesses_public").select("business_name").eq("id", order.business_id).maybeSingle()
      : Promise.resolve({ data: null as { business_name: string } | null }),
    dispute.resolved_by
      ? supabase.from("profiles_public").select("full_name").eq("id", dispute.resolved_by).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string } | null }),
  ]);

  return {
    id: dispute.id,
    orderId: dispute.order_id,
    orderReference: order.order_reference,
    orderStatus: order.status,
    reason: dispute.reason,
    description: dispute.description,
    status: dispute.status,
    sellerResponse: dispute.seller_response,
    sellerRespondedAt: dispute.seller_responded_at,
    resolutionNotes: dispute.resolution_notes,
    resolvedByName: resolvedByProfile?.full_name ?? null,
    resolvedAt: dispute.resolved_at,
    createdAt: dispute.created_at,
    buyerName: buyer?.full_name ?? null,
    sellerName: order.seller_type === "parent" ? (seller?.full_name ?? null) : (business?.business_name ?? null),
    totalCents: order.total_cents,
    subtotalCents: order.subtotal_cents,
  };
}
