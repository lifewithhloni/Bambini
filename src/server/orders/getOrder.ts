import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeliveryTracking } from "@/server/delivery/trackingService";

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
  // Phase 7A: always 0 for collection (unchanged); derived from the
  // buyer's selected delivery quote for a delivery order — see
  // create_order() in 20260930090000_delivery_quoting_booking.sql.
  delivery_fee_cents: number;
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
  // Same public-safe fields getPublicListing()/getCheckoutListing() already
  // expose (profiles_public/businesses_public only) — never a private phone
  // number, ID, or exact address.
  sellerAvatarUrl: string | null;
  sellerIsVerified: boolean;
  pickupLocation: { suburb: string | null; city: string | null } | null;
  // Phase 7A: buyer/seller-safe tracking (see trackingService.ts) — null
  // for a collection order, or a delivery order that hasn't been booked
  // yet (e.g. payment still pending).
  deliveryTracking: { status: string; label: string } | null;
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
      "id, order_reference, status, fulfilment_type, subtotal_cents, delivery_fee_cents, total_cents, commission_rate_bps, commission_amount_cents, currency, created_at, buyer_id, seller_profile_id, business_id, seller_type",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) return null;

  const deliveryTracking = order.fulfilment_type === "delivery" ? await getDeliveryTracking(order.id) : null;

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
    // orders_select_participant_or_admin RLS already proved the caller is
    // a genuine participant (buyer/seller/admin) on THIS order — but
    // product_images_select and product_locations_public (the view the
    // old code here used) both further restrict to status = 'active'
    // (== 'published', see 20260921090000_align_listing_labels.sql),
    // which silently hides a SOLD product's own cover image and pickup
    // suburb from its own buyer/seller the moment create_order() flips
    // it to 'sold' — exactly the same class of gap getCartListings.ts
    // already found and fixed for the cart the same way: the admin
    // client is used for these two reads specifically, narrowly (the
    // product id came from this caller's own already-authorized order,
    // never an arbitrary id, and nothing beyond a cover image path or a
    // suburb/city is read — the same public-safe data any stranger could
    // already see while the listing was published).
    const admin = createAdminClient();
    const [{ data: images }, { data: product }] = await Promise.all([
      admin.from("product_images").select("storage_path, sort_order").eq("product_id", orderItem.product_id).order("sort_order", { ascending: true }).limit(1),
      admin.from("products").select("pickup_location_id").eq("id", orderItem.product_id).maybeSingle(),
    ]);
    coverImagePath = images?.[0]?.storage_path ?? null;
    if (product?.pickup_location_id) {
      const { data: location } = await admin.from("locations").select("suburb, city").eq("id", product.pickup_location_id).maybeSingle();
      pickupLocation = location ?? null;
    }
  }

  let sellerName: string | null = null;
  let sellerAvatarUrl: string | null = null;
  let sellerIsVerified = false;
  if (order.seller_type === "parent" && order.seller_profile_id) {
    const { data } = await supabase
      .from("profiles_public")
      .select("full_name, avatar_url, identity_verification")
      .eq("id", order.seller_profile_id)
      .maybeSingle();
    sellerName = data?.full_name ?? null;
    sellerAvatarUrl = data?.avatar_url ?? null;
    sellerIsVerified = data?.identity_verification === "verified";
  } else if (order.seller_type === "business" && order.business_id) {
    const { data } = await supabase
      .from("businesses_public")
      .select("business_name, logo_url, verification_status")
      .eq("id", order.business_id)
      .maybeSingle();
    sellerName = data?.business_name ?? null;
    sellerAvatarUrl = data?.logo_url ?? null;
    sellerIsVerified = data?.verification_status === "verified";
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
    delivery_fee_cents: order.delivery_fee_cents,
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
    sellerAvatarUrl,
    sellerIsVerified,
    pickupLocation,
    deliveryTracking,
  };
}
