import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OrderReview = { rating: number; comment: string | null; createdAt: string };

/**
 * The buyer's own review of an order, if there is one. Reads the base
 * table, whose only SELECT policy is "the review's own author (or an
 * admin)" — so for any other caller this returns null exactly as for an
 * order with no review, never someone else's review. Selects only the
 * three fields the order page shows: not the reviewer/order/seller ids,
 * and not the reserved hidden_at/seller_response columns (which clients
 * have no column privilege on at all).
 *
 * A review a moderator has hidden is still shown to its author — hiding
 * affects the public view and the seller's rating, not the author's own
 * record — and its existence is what keeps the "leave a review" form away.
 */
export async function getOrderReview(orderId: string): Promise<OrderReview | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("reviews").select("rating, comment, created_at").eq("order_id", orderId).maybeSingle();
  if (!data) return null;
  return { rating: data.rating, comment: data.comment, createdAt: data.created_at };
}
