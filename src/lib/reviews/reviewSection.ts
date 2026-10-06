export type ReviewSectionMode = "form" | "read_only" | "hidden";

/**
 * What the buyer's order page shows for reviews. A UI convenience that
 * mirrors create_review()'s own eligibility (completed order, not yet
 * reviewed); the database re-validates independently regardless.
 *
 *  - a review exists                  -> read-only (never the form again)
 *  - no review, order is 'completed'  -> the form
 *  - anything else (pending, confirmed, disputed, cancelled…) -> nothing
 */
export function reviewSectionMode(input: { orderStatus: string; hasReview: boolean }): ReviewSectionMode {
  if (input.hasReview) return "read_only";
  if (input.orderStatus === "completed") return "form";
  return "hidden";
}
