import { createClient } from "@/lib/supabase/server";

export type StorefrontListing = {
  id: string;
  title: string;
  priceCents: number;
  coverImagePath: string | null;
};

export type BusinessStorefront = {
  id: string;
  businessName: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  location: { suburb: string | null; city: string | null; province: string | null } | null;
  listings: StorefrontListing[];
};

/**
 * businesses_public already only returns a `verification_status =
 * 'verified'` row (see the view definition) — an unverified business
 * simply isn't found here, the same "not found, not a special error"
 * shape as an unpublished product. Never reads the raw `businesses`
 * table, registration/VAT numbers, or business_verifications — nothing
 * private is in this read path at all. Location comes only from
 * product_locations_public (per-listing, suburb/city/province), the
 * same public-safe surface a parent seller's listings already use —
 * businesses has no equivalent "business_locations_public" view of its
 * own, and none is needed: a buyer cares where a specific listing can be
 * collected from, not the business's own location row directly.
 */
export async function getBusinessStorefront(slug: string): Promise<BusinessStorefront | null> {
  const supabase = await createClient();

  const { data: business, error } = await supabase
    .from("businesses_public")
    .select("id, business_name, slug, logo_url, description, rating_average, rating_count")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !business) return null;

  const { data: products } = await supabase
    .from("products")
    .select("id, title, price_cents, product_images(storage_path, sort_order)")
    .eq("business_id", business.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  const listings: StorefrontListing[] = (products ?? []).map((p) => {
    const images = (p.product_images ?? []) as { storage_path: string; sort_order: number }[];
    const cover = [...images].sort((a, b) => a.sort_order - b.sort_order)[0];
    return { id: p.id, title: p.title, priceCents: p.price_cents, coverImagePath: cover?.storage_path ?? null };
  });

  let location: BusinessStorefront["location"] = null;
  if (listings[0]) {
    const { data } = await supabase.from("product_locations_public").select("suburb, city, province").eq("product_id", listings[0].id).maybeSingle();
    location = data ?? null;
  }

  return {
    id: business.id,
    businessName: business.business_name,
    slug: business.slug,
    logoUrl: business.logo_url,
    description: business.description,
    ratingAverage: business.rating_average,
    ratingCount: business.rating_count,
    location,
    listings,
  };
}
