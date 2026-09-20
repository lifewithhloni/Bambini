export type ListingStatus = "draft" | "published" | "archived";

const VALID_STATUSES: readonly string[] = ["draft", "published", "archived"];

/**
 * The full listing lifecycle for this phase — deliberately just these
 * three states, no order-related ones (a listing becoming unavailable
 * because it sold is an order-system concern for a later phase, not a
 * listing state). Publishing from 'archived' isn't allowed directly —
 * an archived listing must return to 'draft' first, a small deliberate
 * friction against instantly re-publishing something that was put away.
 *
 * The underlying `product_status` Postgres enum still technically
 * permits the foundation phase's legacy 'sold'/'removed' labels (see
 * DECISIONS.md — recreating the enum to drop them wasn't worth the
 * migration risk for no functional gain). Nothing in this application
 * ever writes them, but `changeListingStatus()` reads a row's status
 * back as a plain string, so this function's `from`/`to` parameters are
 * only *typed* as ListingStatus at compile time — they aren't
 * guaranteed to actually be one at runtime. `isValidListingStatus()` is
 * the explicit runtime check that keeps a stray legacy value from ever
 * being treated as a legal transition endpoint.
 */
const ALLOWED_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function isValidListingStatus(value: string): value is ListingStatus {
  return VALID_STATUSES.includes(value);
}

export function canTransition(from: string, to: string): boolean {
  if (!isValidListingStatus(from) || !isValidListingStatus(to)) return false;
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Cannot move a listing from "${from}" to "${to}"`);
  }
}
