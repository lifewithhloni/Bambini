import "server-only";
import { createClient } from "@/lib/supabase/server";

export type EditableListing = {
  id: string;
  title: string;
  category_id: string;
  condition: string;
  price_cents: number;
  description: string | null;
  collection_available: boolean;
  delivery_available: boolean;
  status: "draft" | "published" | "archived" | "sold";
  seller_type: "parent" | "business";
  seller_profile_id: string | null;
  business_id: string | null;
  images: { id: string; storage_path: string; sort_order: number }[];
};

/**
 * Returns null both when the listing doesn't exist AND when the caller
 * isn't its owner — the caller (the edit page) treats both as
 * notFound(), the same privacy-preserving pattern used elsewhere in
 * this app: a stranger requesting someone else's (possibly published)
 * listing's edit URL shouldn't be able to tell "wrong id" from "not
 * yours" apart. RLS would actually let a SELECT through for a
 * *published* listing regardless of owner, which is why ownership is
 * re-checked explicitly here rather than just trusting "the query
 * returned a row" — that's the read side; write attempts are blocked by
 * RLS/the update policy regardless of what this page renders.
 */
export async function getListingForEdit(listingId: string, userId: string): Promise<EditableListing | null> {
  const supabase = await createClient();

  const [{ data: listing, error }, { data: ownedBusinesses }, { data: memberBusinesses }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, title, category_id, condition, price_cents, description, collection_available, delivery_available, status, seller_type, seller_profile_id, business_id, product_images(id, storage_path, sort_order)",
      )
      .eq("id", listingId)
      .maybeSingle(),
    supabase.from("businesses").select("id").eq("owner_profile_id", userId),
    supabase.from("business_members").select("business_id").eq("profile_id", userId),
  ]);

  if (error || !listing) return null;

  const managedBusinessIds = new Set([
    ...(ownedBusinesses ?? []).map((b) => b.id),
    ...(memberBusinesses ?? []).map((m) => m.business_id),
  ]);

  const isOwner =
    listing.seller_profile_id === userId || (listing.business_id !== null && managedBusinessIds.has(listing.business_id));
  if (!isOwner) return null;

  const images = ((listing.product_images ?? []) as { id: string; storage_path: string; sort_order: number }[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return { ...listing, images };
}
