import { createClient } from "@/lib/supabase/server";

export type PublicListing = {
  id: string;
  title: string;
  description: string | null;
  condition: string;
  price_cents: number;
  currency: string;
  collection_available: boolean;
  delivery_available: boolean;
  category: { id: string; name: string; slug: string } | null;
  images: string[]; // storage paths, not yet signed
  seller: { name: string; rating_average: number | null; rating_count: number } | null;
  location: { suburb: string | null; city: string | null; province: string | null } | null;
};

/**
 * Public-facing read: relies on the same RLS a stranger's browser would
 * hit (status = 'published', see 20260920091500_rls_policies.sql) —
 * this doesn't add its own "is it published" check because that would
 * just be a second, potentially-drifting copy of what RLS already
 * enforces. A draft or archived listing's id here returns null exactly
 * like a nonexistent one, so the page can't be used to probe which ids
 * exist. Seller identity comes only from profiles_public /
 * businesses_public (name + rating, nothing private); location comes
 * only from product_locations_public (suburb/city/province, never
 * coordinates or the formatted address).
 */
export async function getPublicListing(listingId: string): Promise<PublicListing | null> {
  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id, title, description, condition, price_cents, currency, collection_available, delivery_available, seller_type, seller_profile_id, business_id, category_id, product_images(storage_path, sort_order)",
    )
    .eq("id", listingId)
    .eq("status", "published")
    .maybeSingle();

  if (error || !product) return null;

  const [{ data: category }, { data: location }] = await Promise.all([
    supabase.from("categories").select("id, name, slug").eq("id", product.category_id).maybeSingle(),
    supabase.from("product_locations_public").select("suburb, city, province").eq("product_id", product.id).maybeSingle(),
  ]);

  let seller: PublicListing["seller"] = null;
  if (product.seller_type === "parent" && product.seller_profile_id) {
    const { data } = await supabase
      .from("profiles_public")
      .select("full_name, rating_average, rating_count")
      .eq("id", product.seller_profile_id)
      .maybeSingle();
    if (data) seller = { name: data.full_name, rating_average: data.rating_average, rating_count: data.rating_count };
  } else if (product.seller_type === "business" && product.business_id) {
    const { data } = await supabase
      .from("businesses_public")
      .select("business_name, rating_average, rating_count")
      .eq("id", product.business_id)
      .maybeSingle();
    if (data) seller = { name: data.business_name, rating_average: data.rating_average, rating_count: data.rating_count };
  }

  const images = ((product.product_images ?? []) as { storage_path: string; sort_order: number }[])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => img.storage_path);

  return {
    id: product.id,
    title: product.title,
    description: product.description,
    condition: product.condition,
    price_cents: product.price_cents,
    currency: product.currency,
    collection_available: product.collection_available,
    delivery_available: product.delivery_available,
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    images,
    seller,
    location: location ?? null,
  };
}
