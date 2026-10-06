/**
 * Maps create_review()'s fixed error strings to safe, user-facing text.
 * Nothing from the database error (SQL state, internals, identifiers, the
 * submitted comment) is ever passed through — an unrecognized error gets
 * the generic message.
 */
const KNOWN: Array<[RegExp, string]> = [
  [/Authentication required/i, "Please sign in to leave a review."],
  [/Order not found/i, "We couldn't find that order."],
  [/Order is not completed/i, "You can review an order once it's completed."],
  [/already been reviewed/i, "You've already reviewed this order."],
  [/Invalid rating/i, "Please choose a rating from 1 to 5 stars."],
  [/Invalid comment/i, "Your comment must be between 1 and 1000 characters."],
];

export const GENERIC_REVIEW_ERROR = "We couldn't save your review. Please try again.";

export function humanizeReviewError(message: string | null | undefined): { message: string; known: boolean } {
  const text = message ?? "";
  for (const [pattern, friendly] of KNOWN) {
    if (pattern.test(text)) return { message: friendly, known: true };
  }
  return { message: GENERIC_REVIEW_ERROR, known: false };
}
