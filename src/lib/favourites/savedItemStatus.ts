/**
 * Pure — how a saved item's CURRENT product row maps to what the saved
 * page may show. A favourite is the user's intent/history; whether the
 * item can be bought is separate and always read fresh from products.
 *
 * - published -> "available": full details, links to the listing.
 * - sold      -> "sold": details still shown (it was public while
 *   published, and only ever becomes sold from published), clearly marked
 *   unavailable.
 * - anything else that exists (archived, draft) -> "unavailable": NO
 *   details. archived can be reached straight from draft, so an
 *   archived/draft row might never have been public — showing its title,
 *   price, or photo could leak unpublished content to whoever saved its id.
 * - no row at all -> "removed".
 */
export type SavedItemStatus = "available" | "sold" | "unavailable" | "removed";

export function classifySavedItem(product: { status: string } | null | undefined): SavedItemStatus {
  if (!product) return "removed";
  if (product.status === "published") return "available";
  if (product.status === "sold") return "sold";
  return "unavailable";
}

/** Whether the item's own details (title, price, photo, seller) may be shown at all. */
export function savedItemShowsDetails(status: SavedItemStatus): boolean {
  return status === "available" || status === "sold";
}
