import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrderSummary = {
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
  sellerName: string | null;
  /** True only for an ACTIVE (open/under_review) dispute — a resolved/closed one doesn't change what the orders list surfaces as the order's current next action. */
  hasActiveDispute: boolean;
};

const ACTIVE_DISPUTE_STATUSES = ["open", "under_review"] as const;

/**
 * Flat queries batched by the resulting order ids (never a nested
 * PostgREST embed — see getOrder.ts's header comment for why), scoped to
 * the caller's own orders via buyer_id, mirroring RLS
 * (orders_select_participant_or_admin) rather than relying on it alone.
 *
 * Phase 12D extends this additively with exactly the fields the orders
 * list UI needs to show a useful card (image, seller identity, next
 * action) without a per-order N+1 fetch — coverImagePath/sellerName/
 * payment_method/hasActiveDispute — using the same public-safe sources
 * (product_images, profiles_public/businesses_public) every other
 * buyer-facing read in this codebase already uses. Nothing here exposes
 * commission, delivery provider cost, or any seller-private field.
 */
export async function getMyOrders(buyerId: string): Promise<OrderSummary[]> {
  const supabase = await createClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_reference, status, fulfilment_type, total_cents, currency, created_at, seller_type, seller_profile_id, business_id")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });

  if (error || !orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);

  const [{ data: items }, { data: payments }, { data: disputes }] = await Promise.all([
    supabase.from("order_items").select("order_id, product_id, title_snapshot").in("order_id", orderIds),
    supabase.from("payments").select("order_id, status, method").in("order_id", orderIds),
    supabase.from("disputes").select("order_id, status").in("order_id", orderIds).in("status", ACTIVE_DISPUTE_STATUSES),
  ]);

  const titleByOrder = new Map((items ?? []).map((i) => [i.order_id, i.title_snapshot]));
  const productIdByOrder = new Map((items ?? []).map((i) => [i.order_id, i.product_id]));
  const paymentStatusByOrder = new Map((payments ?? []).map((p) => [p.order_id, p.status]));
  const paymentMethodByOrder = new Map((payments ?? []).map((p) => [p.order_id, p.method]));
  const activeDisputeOrderIds = new Set((disputes ?? []).map((d) => d.order_id));

  // product_images_select RLS only allows a non-owner to see a
  // 'published' product's images (see getOrder.ts's own doc comment for
  // the full reasoning) — a purchased listing is always 'sold' by the
  // time an order exists, so the admin client is used for this one read
  // specifically; every product id here came from this buyer's own
  // orders, never an arbitrary id.
  const productIds = Array.from(new Set((items ?? []).map((i) => i.product_id).filter((id): id is string => !!id)));
  const { data: images } =
    productIds.length > 0
      ? await createAdminClient().from("product_images").select("product_id, storage_path, sort_order").in("product_id", productIds)
      : { data: [] as { product_id: string; storage_path: string; sort_order: number }[] };
  // Pick the lowest sort_order per product — images arrive in whatever
  // order Postgres happens to return them, so sort before picking rather
  // than trusting array order.
  const sortedImages = [...(images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const coverByProduct = new Map<string, string>();
  for (const img of sortedImages) {
    if (!coverByProduct.has(img.product_id)) coverByProduct.set(img.product_id, img.storage_path);
  }

  const parentSellerIds = Array.from(new Set(orders.filter((o) => o.seller_type === "parent" && o.seller_profile_id).map((o) => o.seller_profile_id as string)));
  const businessSellerIds = Array.from(new Set(orders.filter((o) => o.seller_type === "business" && o.business_id).map((o) => o.business_id as string)));

  const [{ data: profiles }, { data: businesses }] = await Promise.all([
    parentSellerIds.length > 0 ? supabase.from("profiles_public").select("id, full_name").in("id", parentSellerIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    businessSellerIds.length > 0
      ? supabase.from("businesses_public").select("id, business_name").in("id", businessSellerIds)
      : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
  ]);
  const nameByProfileId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const nameByBusinessId = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  return orders.map((o) => {
    const productId = productIdByOrder.get(o.id) ?? null;
    const sellerName = o.seller_type === "parent" ? (nameByProfileId.get(o.seller_profile_id ?? "") ?? null) : (nameByBusinessId.get(o.business_id ?? "") ?? null);

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
      sellerName,
      hasActiveDispute: activeDisputeOrderIds.has(o.id),
    };
  });
}
