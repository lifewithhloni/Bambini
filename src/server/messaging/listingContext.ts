import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifySavedItem, savedItemShowsDetails } from "@/lib/favourites/savedItemStatus";

export type ListingContext = {
  productId: string;
  /** Present only while the listing is published or sold — see savedItemShowsDetails(). Never for archived/draft. */
  title: string | null;
  /** "available" links to the listing; "sold" is context only; "unavailable" covers archived/draft/deleted. */
  status: "available" | "sold" | "unavailable";
  href: string | null;
};

/**
 * The listing a conversation is about, read fresh. products RLS only
 * shows a non-owner PUBLISHED rows, which would hide a since-sold listing
 * from the very conversation it produced, so this reads through the admin
 * client — narrowly: only ids taken from threads the caller already
 * participates in, and a title only for published/sold products (the same
 * classification the saved-items page uses, so an archived or draft
 * listing's details are never surfaced, and a deleted one — its thread's
 * product_id is NULL — is simply "unavailable"). Seller-private data
 * (address, commission, verification) is never selected.
 */
export async function getListingContexts(productIds: (string | null)[]): Promise<Map<string, ListingContext>> {
  const ids = Array.from(new Set(productIds.filter((id): id is string => !!id)));
  const contexts = new Map<string, ListingContext>();
  if (ids.length === 0) return contexts;

  const { data } = await createAdminClient().from("products").select("id, title, status").in("id", ids);
  for (const product of data ?? []) {
    const classified = classifySavedItem(product);
    const shows = savedItemShowsDetails(classified);
    contexts.set(product.id, {
      productId: product.id,
      title: shows ? product.title : null,
      status: classified === "available" ? "available" : classified === "sold" ? "sold" : "unavailable",
      href: classified === "available" ? `/listings/${product.id}` : null,
    });
  }
  return contexts;
}

export function contextFor(contexts: Map<string, ListingContext>, productId: string | null): ListingContext {
  return (productId && contexts.get(productId)) || { productId: productId ?? "", title: null, status: "unavailable", href: null };
}
