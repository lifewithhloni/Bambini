"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type ReviewBusinessActionState = { error: string } | null;

/** Mirrors reviewVerificationAction.ts exactly — review_business_verification() is the actual authorization boundary, re-validating is_admin() itself. */
export async function reviewBusinessVerification(submissionId: string, decision: "verified" | "rejected", _prev: ReviewBusinessActionState, formData: FormData): Promise<ReviewBusinessActionState> {
  await requireAdmin("/admin/business-verifications");

  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_business_verification", {
    p_submission_id: submissionId,
    p_decision: decision,
    p_notes: notes,
  });

  if (error) {
    return { error: humanizeReviewError(error.message) };
  }

  revalidatePath("/admin/business-verifications");
  return null;
}

function humanizeReviewError(message?: string): string {
  if (!message) return "Could not save this review. Please try again.";
  if (/already been reviewed/i.test(message)) return "This submission has already been reviewed.";
  if (/not found/i.test(message)) return "Submission not found.";
  return "Could not save this review. Please try again.";
}
