"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type ReviewActionState = { error: string } | null;

/**
 * The RPC (review_identity_verification()) is the actual authorization
 * boundary — it independently re-validates is_admin() from auth.uid(),
 * never trusting that this action was only reachable by an admin in the
 * first place. requireAdmin() here is a UI convenience (so a non-admin
 * gets a 404 on the page itself), not a substitute for that.
 */
export async function reviewVerification(submissionId: string, decision: "verified" | "rejected", _prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  await requireAdmin("/admin/verifications");

  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_identity_verification", {
    p_submission_id: submissionId,
    p_decision: decision,
    p_notes: notes,
  });

  if (error) {
    return { error: humanizeReviewError(error.message) };
  }

  revalidatePath("/admin/verifications");
  return null;
}

function humanizeReviewError(message?: string): string {
  if (!message) return "Could not save this review. Please try again.";
  if (/already been reviewed/i.test(message)) return "This submission has already been reviewed.";
  if (/already verified on a different account/i.test(message)) return "This ID number is already verified on a different account.";
  if (/not found/i.test(message)) return "Submission not found.";
  return "Could not save this review. Please try again.";
}
