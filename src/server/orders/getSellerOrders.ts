import { createClient } from "@/lib/supabase/server";

export type SellerOrderSummary = {
  id: string;
  order_reference: string;
  status: string;
  payment_status: string;
  fulfilment_type: string;
  total_cents: number;
  currency: string;
  created_at: string;
  productTitle: string | null;
  buyerName: string | null;
};

/**
 * Same flat-query shape as getMyOrders.ts, scoped to orders for listings
 * the caller sold — as a parent seller, or as a member of a business
 * that sold them (same business-membership resolution as
 * getMyListings.ts). Buyer name comes only from profiles_public (full
 * name, nothing private) — "buyer information appropriate to expose."
 */
export async function getSellerOrders(userId: string): Promise<SellerOrderSummary[]> {
  const supabase = await createClient();

  const [{ data: ownedBusinesses }, { data: memberBusinesses }] = await Promise.all([
    supabase.from("businesses").select("id").eq("owner_profile_id", userId),
    supabase.from("business_members").select("business_id").eq("profile_id", userId),
  ]);

  const businessIds = Array.from(
    new Set([...(ownedBusinesses ?? []).map((b) => b.id), ...(memberBusinesses ?? []).map((m) => m.business_id)]),
  );

  const orFilter =
    businessIds.length > 0
      ? `seller_profile_id.eq.${userId},business_id.in.(${businessIds.join(",")})`
      : `seller_profile_id.eq.${userId}`;

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_reference, status, fulfilment_type, total_cents, currency, created_at, buyer_id")
    .or(orFilter)
    .order("created_at", { ascending: false });

  if (error || !orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const buyerIds = Array.from(new Set(orders.map((o) => o.buyer_id)));

  const [{ data: items }, { data: payments }, { data: buyers }] = await Promise.all([
    supabase.from("order_items").select("order_id, title_snapshot").in("order_id", orderIds),
    supabase.from("payments").select("order_id, status").in("order_id", orderIds),
    supabase.from("profiles_public").select("id, full_name").in("id", buyerIds),
  ]);

  const titleByOrder = new Map((items ?? []).map((i) => [i.order_id, i.title_snapshot]));
  const paymentStatusByOrder = new Map((payments ?? []).map((p) => [p.order_id, p.status]));
  const buyerNameById = new Map((buyers ?? []).map((b) => [b.id, b.full_name]));

  return orders.map((o) => ({
    id: o.id,
    order_reference: o.order_reference,
    status: o.status,
    payment_status: paymentStatusByOrder.get(o.id) ?? "pending",
    fulfilment_type: o.fulfilment_type,
    total_cents: o.total_cents,
    currency: o.currency,
    created_at: o.created_at,
    productTitle: titleByOrder.get(o.id) ?? null,
    buyerName: buyerNameById.get(o.buyer_id) ?? null,
  }));
}
