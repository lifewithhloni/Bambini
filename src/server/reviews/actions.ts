"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { humanizeReviewError } from "./errors";
import { parseReviewForm } from "./validation";

export type ReviewActionState = { error: string } | { success: true } | null;

/**
 * create_review() is the real authorization/validation boundary: it
 * derives the reviewer from the session, the seller (parent or business)
 * from the order, and re-checks that the caller is the order's buyer, the
 * order is completed, and it hasn't been reviewed. requireUser() is the
 * same UI-convenience gate every authenticated action here uses.
 *
 * The client supplies ONLY the order, a rating and an optional comment —
 * a reviewer, seller, business, product, seller_response, created_at or
 * hidden_at in the submitted form is never read, and the RPC has no
 * parameter that could carry one.
 *
 * Never logged: the comment, the order id, the user id. An unrecognized
 * failure logs one static line.
 */
export async function submitReview(orderId: string, _prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const parsed = parseReviewForm(orderId, formData);
  if (!parsed.ok) return { error: parsed.error };

  await requireUser(`/account/orders/${parsed.data.orderId}`);
  const supabase = await createClient();

  const { error } = await supabase.rpc("create_review", {
    p_order_id: parsed.data.orderId,
    p_rating: parsed.data.rating,
    p_comment: parsed.data.comment,
  });

  if (error) {
    const friendly = humanizeReviewError(error.message);
    if (!friendly.known) console.error("Review submission failed unexpectedly.");
    return { error: friendly.message };
  }

  revalidatePath(`/account/orders/${parsed.data.orderId}`);
  return { success: true };
}
