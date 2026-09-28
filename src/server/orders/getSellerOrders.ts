import { createClient } from "@/lib/supabase/server";

export type SellerOrderSummary = {
  id: string;
  order_reference: string;
  status: string;
  payment_status: string;
  payment_method: string;
  fulfilment_type: string;
  total_cents: number;
  currency: string;
  created_at: string;
  productTitle: string | null;
  coverImagePath: string | null;
  buyerName: string | null;
  /** True only for an ACTIVE (open/under_review) dispute. */
  hasActiveDispute: boolean;
};

const ACTIVE_DISPUTE_STATUSES = ["open", "under_review"] as const;

/**
 * Same flat-query shape as getMyOrders.ts, scoped to orders for listings
 * the caller sold — as a parent seller, or as a member of a business
 * that sold them (same business-membership resolution as
 * getMyListings.ts). Buyer name comes only from profiles_public (full
 * name, nothing private) — "buyer information appropriate to expose."
 *
 * Phase 13A extends this additively with payment_method/coverImagePath/
 * hasActiveDispute, the same fields Phase 12D added to getMyOrders() for
 * the equivalent buyer list — unlike that buyer-side extension, this one
 * reads product_images through the caller's own session client rather
 * than the admin client: a seller viewing their OWN listing's images is
 * already covered by product_images_select RLS regardless of the
 * product's status (p.seller_profile_id = auth.uid() / is_business_member()),
 * so there's no equivalent "sold listing becomes invisible" gap here.
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

  return hydrateSellerOrders(supabase, orders);
}

/**
 * Phase 13B: one specific business's own orders — the business-scoped
 * counterpart to getSellerOrders() (which deliberately aggregates a
 * user's personal AND every business's orders). The explicit
 * .eq("business_id") narrows an otherwise multi-business-capable RLS
 * read (orders_select_participant_or_admin, is_business_member()) down
 * to the one business a page is about; a businessId the caller isn't a
 * member of returns zero rows, never an error. Shares every other line of
 * shaping/hydration with getSellerOrders() rather than duplicating it.
 */
export async function getBusinessOrders(businessId: string): Promise<SellerOrderSummary[]> {
  const supabase = await createClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_reference, status, fulfilment_type, total_cents, currency, created_at, buyer_id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error || !orders || orders.length === 0) return [];

  return hydrateSellerOrders(supabase, orders);
}

type SellerOrderRow = {
  id: string;
  order_reference: string;
  status: string;
  fulfilment_type: string;
  total_cents: number;
  currency: string;
  created_at: string;
  buyer_id: string;
};

async function hydrateSellerOrders(supabase: Awaited<ReturnType<typeof createClient>>, orders: SellerOrderRow[]): Promise<SellerOrderSummary[]> {
  const orderIds = orders.map((o) => o.id);
  const buyerIds = Array.from(new Set(orders.map((o) => o.buyer_id)));

  const [{ data: items }, { data: payments }, { data: buyers }, { data: disputes }] = await Promise.all([
    supabase.from("order_items").select("order_id, product_id, title_snapshot").in("order_id", orderIds),
    supabase.from("payments").select("order_id, status, method").in("order_id", orderIds),
    supabase.from("profiles_public").select("id, full_name").in("id", buyerIds),
    supabase.from("disputes").select("order_id, status").in("order_id", orderIds).in("status", ACTIVE_DISPUTE_STATUSES),
  ]);

  const titleByOrder = new Map((items ?? []).map((i) => [i.order_id, i.title_snapshot]));
  const productIdByOrder = new Map((items ?? []).map((i) => [i.order_id, i.product_id]));
  const paymentStatusByOrder = new Map((payments ?? []).map((p) => [p.order_id, p.status]));
  const paymentMethodByOrder = new Map((payments ?? []).map((p) => [p.order_id, p.method]));
  const buyerNameById = new Map((buyers ?? []).map((b) => [b.id, b.full_name]));
  const activeDisputeOrderIds = new Set((disputes ?? []).map((d) => d.order_id));

  const productIds = Array.from(new Set((items ?? []).map((i) => i.product_id).filter((id): id is string => !!id)));
  const { data: images } =
    productIds.length > 0
      ? await supabase.from("product_images").select("product_id, storage_path, sort_order").in("product_id", productIds)
      : { data: [] as { product_id: string; storage_path: string; sort_order: number }[] };
  const sortedImages = [...(images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const coverByProduct = new Map<string, string>();
  for (const img of sortedImages) {
    if (!coverByProduct.has(img.product_id)) coverByProduct.set(img.product_id, img.storage_path);
  }

  return orders.map((o) => {
    const productId = productIdByOrder.get(o.id) ?? null;
    return {
      id: o.id,
      order_reference: o.order_reference,
      status: o.status,
      payment_status: paymentStatusByOrder.get(o.id) ?? "pending",
      payment_method: paymentMethodByOrder.get(o.id) ?? "online",
      fulfilment_type: o.fulfilment_type,
      total_cents: o.total_cents,
      currency: o.currency,
      created_at: o.created_at,
      productTitle: titleByOrder.get(o.id) ?? null,
      coverImagePath: productId ? (coverByProduct.get(productId) ?? null) : null,
      buyerName: buyerNameById.get(o.buyer_id) ?? null,
      hasActiveDispute: activeDisputeOrderIds.has(o.id),
    };
  });
}
