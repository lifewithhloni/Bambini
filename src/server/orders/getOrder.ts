import { createClient } from "@/lib/supabase/server";

export type OrderDetail = {
  id: string;
  order_reference: string;
  status: string;
  payment_status: string;
  payment_method: string;
  // Only meaningful for the seller-framed view (see OrderDetailView.tsx)
  // — Phase 4C's commission settlement_status, never rendered for a
  // buyer (the brief is explicit: internal commission details are not
  // the buyer's business).
  commission_settlement_status: string | null;
  fulfilment_type: string;
  subtotal_cents: number;
  total_cents: number;
  commission_rate_bps: number;
  commission_amount_cents: number;
  currency: string;
  created_at: string;
  buyer_id: string;
  seller_profile_id: string | null;
  business_id: string | null;
  seller_type: string;
  item: {
    productId: string;
    title: string;
    priceCents: number;
    coverImagePath: string | null;
  } | null;
  buyerName: string | null;
  sellerName: string | null;
  pickupLocation: { suburb: string | null; city: string | null } | null;
};

/**
 * Relies on the same RLS the buyer/seller's own dashboard queries would
 * hit (orders_select_participant_or_admin — buyer, seller, or admin
 * only, see 20260920091500_rls_policies.sql) — an order id that exists
 * but doesn't belong to the caller returns null here exactly like one
 * that doesn't exist at all, the same not-found-vs-not-yours privacy
 * pattern getPublicListing()/getListingForEdit() already use. Every
 * related read below is a plain, flat query (never a nested PostgREST
 * embed) so the result shape never depends on assumptions about
 * how a 1:1 relationship gets embedded — this project has no live
 * PostgREST instance to verify that behavior against (see DATABASE.md).
 */
export async function getOrder(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, order_reference, status, fulfilment_type, subtotal_cents, total_cents, commission_rate_bps, commission_amount_cents, currency, created_at, buyer_id, seller_profile_id, business_id, seller_type",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) return null;

  const [{ data: orderItem }, { data: payment }, { data: commission }, { data: buyerProfile }] = await Promise.all([
    supabase
      .from("order_items")
      .select("product_id, title_snapshot, price_cents_snapshot")
      .eq("order_id", orderId)
      .maybeSingle(),
    supabase.from("payments").select("status, method").eq("order_id", orderId).maybeSingle(),
    supabase.from("commissions").select("settlement_status").eq("order_id", orderId).maybeSingle(),
    supabase.from("profiles_public").select("full_name").eq("id", order.buyer_id).maybeSingle(),
  ]);

  let coverImagePath: string | null = null;
  let pickupLocation: OrderDetail["pickupLocation"] = null;
  if (orderItem?.product_id) {
    const [{ data: images }, { data: location }] = await Promise.all([
      supabase
        .from("product_images")
        .select("storage_path, sort_order")
        .eq("product_id", orderItem.product_id)
        .order("sort_order", { ascending: true })
        .limit(1),
      supabase.from("product_locations_public").select("suburb, city").eq("product_id", orderItem.product_id).maybeSingle(),
    ]);
    coverImagePath = images?.[0]?.storage_path ?? null;
    pickupLocation = location ?? null;
  }

  let sellerName: string | null = null;
  if (order.seller_type === "parent" && order.seller_profile_id) {
    const { data } = await supabase.from("profiles_public").select("full_name").eq("id", order.seller_profile_id).maybeSingle();
    sellerName = data?.full_name ?? null;
  } else if (order.seller_type === "business" && order.business_id) {
    const { data } = await supabase.from("businesses_public").select("business_name").eq("id", order.business_id).maybeSingle();
    sellerName = data?.business_name ?? null;
  }

  return {
    id: order.id,
    order_reference: order.order_reference,
    status: order.status,
    payment_status: payment?.status ?? "pending",
    payment_method: payment?.method ?? "online",
    commission_settlement_status: commission?.settlement_status ?? null,
    fulfilment_type: order.fulfilment_type,
    subtotal_cents: order.subtotal_cents,
    total_cents: order.total_cents,
    commission_rate_bps: order.commission_rate_bps,
    commission_amount_cents: order.commission_amount_cents,
    currency: order.currency,
    created_at: order.created_at,
    buyer_id: order.buyer_id,
    seller_profile_id: order.seller_profile_id,
    business_id: order.business_id,
    seller_type: order.seller_type,
    item: orderItem
      ? {
          productId: orderItem.product_id,
          title: orderItem.title_snapshot,
          priceCents: orderItem.price_cents_snapshot,
          coverImagePath,
        }
      : null,
    buyerName: buyerProfile?.full_name ?? null,
    sellerName,
    pickupLocation,
  };
}
