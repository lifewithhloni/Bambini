import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MyListing = {
  id: string;
  title: string;
  price_cents: number;
  status: "draft" | "published" | "archived";
  condition: string;
  created_at: string;
  updated_at: string;
  seller_type: "parent" | "business";
  cover_image_path: string | null;
};

/**
 * "My listings" is narrower than what RLS alone would let this query
 * return (RLS also allows reading every *published* listing, seller
 * unrelated) — this explicitly scopes to listings the signed-in user
 * actually owns: their own parent-type listings, plus any business-type
 * listing for a business they own or are a member of. Business
 * membership is resolved the same way is_business_member() resolves it
 * server-side (owner_profile_id match OR a business_members row) — no
 * business-creation UI exists yet this phase, so in practice this is
 * usually just the parent-type half, but the query is written to be
 * correct once it isn't.
 */
export async function getMyListings(userId: string): Promise<MyListing[]> {
  const supabase = await createClient();

  const [{ data: ownedBusinesses }, { data: memberBusinesses }] = await Promise.all([
    supabase.from("businesses").select("id").eq("owner_profile_id", userId),
    supabase.from("business_members").select("business_id").eq("profile_id", userId),
  ]);

  const businessIds = Array.from(
    new Set([...(ownedBusinesses ?? []).map((b) => b.id), ...(memberBusinesses ?? []).map((m) => m.business_id)]),
  );

  const orFilter = businessIds.length > 0
    ? `seller_profile_id.eq.${userId},business_id.in.(${businessIds.join(",")})`
    : `seller_profile_id.eq.${userId}`;

  const { data, error } = await supabase
    .from("products")
    .select("id, title, price_cents, status, condition, created_at, updated_at, seller_type, product_images(storage_path, sort_order)")
    .or(orFilter)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => {
    const images = (row.product_images ?? []) as { storage_path: string; sort_order: number }[];
    const cover = [...images].sort((a, b) => a.sort_order - b.sort_order)[0];
    return {
      id: row.id,
      title: row.title,
      price_cents: row.price_cents,
      status: row.status,
      condition: row.condition,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_type: row.seller_type,
      cover_image_path: cover?.storage_path ?? null,
    };
  });
}
