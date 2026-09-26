import { createClient } from "@/lib/supabase/server";

export type CheckoutListing = {
  id: string;
  title: string;
  condition: string;
  priceCents: number;
  currency: string;
  collectionAvailable: boolean;
  deliveryAvailable: boolean;
  coverImagePath: string | null;
  sellerType: "parent" | "business";
  sellerProfileId: string | null;
  businessId: string | null;
  sellerName: string | null;
  // Same public-safe seller fields getPublicListing() already exposes
  // (profiles_public/businesses_public only) — never a private phone
  // number, ID, or exact address. isVerified mirrors the same
  // identity_verification / verification_status fields the public
  // listing badge already uses (see
  // 20261009090000_public_identity_verification_badge.sql).
  sellerAvatarUrl: string | null;
  sellerIsVerified: boolean;
  // Approximate only (suburb/city/province) — from product_locations_public,
  // the same view getPublicListing() uses; never coordinates or a
  // formatted street address.
  location: { suburb: string | null; city: string | null; province: string | null } | null;
  // Whether "Cash on collection" should even be offered — both the
  // platform-wide switch and this specific seller's freshly-evaluated
  // eligibility. Display only: create_order() independently re-checks
  // both server-side regardless of what this says (see
  // 20260927090000_cash_collection_transactions.sql) — a buyer can never
  // force a cash order into existence just by submitting the field.
  cashOffered: boolean;
};

/**
 * The checkout review page's own read — deliberately separate from
 * getPublicListing() (which doesn't expose seller_profile_id/business_id
 * at all, since the product page has no reason to know them). Nothing
 * shown here is authoritative for the actual purchase: create_order()
 * independently reloads the product and derives price/seller/commission
 * itself (see 20260925090000_orders_checkout.sql) — this is display
 * only, for the buyer to review before submitting.
 */
export async function getCheckoutListing(productId: string): Promise<CheckoutListing | null> {
  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id, title, condition, price_cents, currency, collection_available, delivery_available, seller_type, seller_profile_id, business_id, product_images(storage_path, sort_order)",
    )
    .eq("id", productId)
    .eq("status", "published")
    .maybeSingle();

  if (error || !product) return null;

  const images = (product.product_images ?? []) as { storage_path: string; sort_order: number }[];
  const cover = [...images].sort((a, b) => a.sort_order - b.sort_order)[0];

  const { data: location } = await supabase.from("product_locations_public").select("suburb, city, province").eq("product_id", product.id).maybeSingle();

  let sellerName: string | null = null;
  let sellerAvatarUrl: string | null = null;
  let sellerIsVerified = false;
  if (product.seller_type === "parent" && product.seller_profile_id) {
    const { data } = await supabase
      .from("profiles_public")
      .select("full_name, avatar_url, identity_verification")
      .eq("id", product.seller_profile_id)
      .maybeSingle();
    sellerName = data?.full_name ?? null;
    sellerAvatarUrl = data?.avatar_url ?? null;
    sellerIsVerified = data?.identity_verification === "verified";
  } else if (product.seller_type === "business" && product.business_id) {
    const { data } = await supabase
      .from("businesses_public")
      .select("business_name, logo_url, verification_status")
      .eq("id", product.business_id)
      .maybeSingle();
    sellerName = data?.business_name ?? null;
    sellerAvatarUrl = data?.logo_url ?? null;
    sellerIsVerified = data?.verification_status === "verified";
  }

  let cashOffered = false;
  if (product.collection_available) {
    const [{ data: cashSettings }, { data: eligible }] = await Promise.all([
      supabase.from("cash_settings").select("is_enabled").eq("id", true).maybeSingle(),
      supabase.rpc("is_seller_cash_eligible", {
        p_seller_type: product.seller_type,
        p_seller_profile_id: product.seller_profile_id,
        p_business_id: product.business_id,
      }),
    ]);
    cashOffered = !!cashSettings?.is_enabled && !!eligible;
  }

  return {
    id: product.id,
    title: product.title,
    condition: product.condition,
    priceCents: product.price_cents,
    currency: product.currency,
    collectionAvailable: product.collection_available,
    deliveryAvailable: product.delivery_available,
    coverImagePath: cover?.storage_path ?? null,
    sellerType: product.seller_type,
    sellerProfileId: product.seller_profile_id,
    businessId: product.business_id,
    sellerName,
    sellerAvatarUrl,
    sellerIsVerified,
    location: location ?? null,
    cashOffered,
  };
}
