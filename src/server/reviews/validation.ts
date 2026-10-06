export const REVIEW_COMMENT_MAX = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewInput = { orderId: string; rating: number; comment: string | null };
export type ParseReviewResult = { ok: true; data: ReviewInput } | { ok: false; error: string };

/** Postgres counts characters (code points); String.length counts UTF-16 units, so emoji would be over-counted. */
function characterCount(s: string): number {
  return [...s].length;
}

/**
 * Validates exactly the three things a buyer may supply — which order,
 * how many stars, and an optional comment — and nothing else. Anything
 * about WHO is reviewing or WHO is being reviewed is deliberately not
 * representable here: create_review() derives the reviewer from the
 * session and the seller from the order.
 *
 * This is a UX-friendly first pass so a bad value gets a clean message;
 * create_review() and the table constraints re-validate independently and
 * remain the real guarantee (rating 1-5 integer; comment optional, trimmed,
 * 1-1000 characters, never silently truncated).
 *
 * A blank comment box ("") means "no comment" (stored as NULL). A comment
 * that is only whitespace is rejected rather than quietly dropped.
 */
export function parseReviewInput(input: { orderId: unknown; rating: unknown; comment: unknown }): ParseReviewResult {
  if (typeof input.orderId !== "string" || !UUID_RE.test(input.orderId)) {
    return { ok: false, error: "We couldn't find that order." };
  }

  const rawRating = typeof input.rating === "number" ? String(input.rating) : input.rating;
  if (typeof rawRating !== "string" || !/^[1-5]$/.test(rawRating)) {
    return { ok: false, error: "Please choose a rating from 1 to 5 stars." };
  }

  let comment: string | null = null;
  if (input.comment !== null && input.comment !== undefined && input.comment !== "") {
    if (typeof input.comment !== "string") return { ok: false, error: "Your comment couldn't be read. Please try again." };
    const trimmed = input.comment.trim();
    if (trimmed === "") return { ok: false, error: "Please write a comment, or leave it blank." };
    if (characterCount(trimmed) > REVIEW_COMMENT_MAX) {
      return { ok: false, error: `Your comment is too long. Please keep it to ${REVIEW_COMMENT_MAX} characters or fewer.` };
    }
    comment = trimmed;
  }

  return { ok: true, data: { orderId: input.orderId, rating: Number(rawRating), comment } };
}

/** Reads only order id, rating and comment from a form — any other field (reviewer, seller, product, timestamps…) is never looked at. */
export function parseReviewForm(orderId: string, formData: FormData): ParseReviewResult {
  return parseReviewInput({ orderId, rating: formData.get("rating"), comment: formData.get("comment") });
}
