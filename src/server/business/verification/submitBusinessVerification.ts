"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { validateDocumentFile, buildBusinessVerificationDocumentPath } from "@/server/verification/documentValidation";

export type SubmitBusinessVerificationState = { error: string } | null;

/**
 * Mirrors submitIdentityVerification.ts exactly. business_id is a route
 * parameter, never trusted alone — the storage upload and the table
 * INSERT are both independently re-checked by RLS
 * (business_verification_documents_storage_insert_member /
 * business_verifications_insert), which require is_business_member(),
 * so a user submitting for a business they don't manage is rejected
 * regardless of what this action assumes.
 */
export async function submitBusinessVerification(businessId: string, _prev: SubmitBusinessVerificationState, formData: FormData): Promise<SubmitBusinessVerificationState> {
  await requireUser(`/account/business/${businessId}`);

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a document to upload." };
  }
  const fileCheck = validateDocumentFile({ type: file.type, size: file.size, name: file.name });
  if (!fileCheck.ok) {
    return { error: fileCheck.error };
  }

  const documentType = String(formData.get("documentType") ?? "").trim();
  if (!documentType) {
    return { error: "Describe what this document is (e.g. business registration certificate)." };
  }

  const supabase = await createClient();

  const { data: latest } = await supabase
    .from("business_verifications")
    .select("status")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.status === "pending") {
    return { error: "Your submission is already under review." };
  }

  const path = buildBusinessVerificationDocumentPath(businessId, file.type, randomUUID());
  const { error: uploadError } = await supabase.storage.from("verification-documents").upload(path, file, { contentType: file.type });
  if (uploadError) {
    return { error: "Could not upload your document. Please try again." };
  }

  const { error: insertError } = await supabase.from("business_verifications").insert({
    business_id: businessId,
    document_type: documentType,
    document_storage_path: path,
  });

  if (insertError) {
    await supabase.storage.from("verification-documents").remove([path]);
    return { error: "Could not submit your business for verification. Please try again." };
  }

  revalidatePath(`/account/business/${businessId}`);
  return null;
}
