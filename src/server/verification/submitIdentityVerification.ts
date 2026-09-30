"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { validateSaIdNumber } from "./idNumberValidation";
import { buildVerificationDocumentPath, sanitizeFullNameForStoragePath, validateDocumentFile } from "./documentValidation";

export type SubmitVerificationState = { error: string } | null;

/**
 * Every value that matters is either derived server-side (profile_id =
 * requireUser()'s own id, never a form field) or independently
 * re-validated by the database (the 13-digit CHECK constraint mirrors
 * validateSaIdNumber()'s format check; the column-level INSERT grant
 * already excludes status/reviewed_by/reviewed_at/notes — this action
 * couldn't set them even if it tried). The Luhn checksum here is a
 * data-entry aid only; passing it never implies verification — only
 * review_identity_verification() (admin-only) can ever do that.
 */
export async function submitIdentityVerification(_prev: SubmitVerificationState, formData: FormData): Promise<SubmitVerificationState> {
  const user = await requireUser("/account/verification");

  const idNumberRaw = String(formData.get("idNumber") ?? "").trim();
  const idCheck = validateSaIdNumber(idNumberRaw);
  if (!idCheck.ok) {
    return { error: idCheck.error };
  }

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo, scan, or PDF of your ID document." };
  }
  const fileCheck = validateDocumentFile({ type: file.type, size: file.size, name: file.name });
  if (!fileCheck.ok) {
    return { error: fileCheck.error };
  }

  const supabase = await createClient();

  // A UX courtesy, not the security boundary — the database itself
  // happily accepts a second 'pending' row (see the migration's own
  // comment on why history is append-only), this just avoids the
  // confusing appearance of "resubmitting" while one is already under
  // review.
  const { data: latest } = await supabase
    .from("identity_verifications")
    .select("status")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.status === "pending") {
    return { error: "Your submission is already under review." };
  }

  // The folder itself — human-readable, e.g. "Lehlohonolo_Maishoane_01" —
  // is allocated once per profile by allocate_verification_folder_slug()
  // (20261015090000_identity_verification_privacy_and_size.sql), which
  // is also the real authorization boundary for it; this action only
  // ever supplies a sanitized base name, never the final folder, and
  // never a client-influenced value. A resubmission reuses the same
  // folder the function already allocated on first submission.
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const baseName = sanitizeFullNameForStoragePath(profile?.full_name ?? "");
  const { data: folderName, error: allocateError } = await supabase.rpc("allocate_verification_folder_slug", { p_base_name: baseName });
  if (allocateError || !folderName) {
    return { error: "Could not submit your verification. Please try again." };
  }

  const path = buildVerificationDocumentPath(folderName, file.type);
  const { error: uploadError } = await supabase.storage.from("verification-documents").upload(path, file, { contentType: file.type });
  if (uploadError) {
    return { error: "Could not upload your document. Please try again." };
  }

  const { error: insertError } = await supabase.from("identity_verifications").insert({
    profile_id: user.id,
    provider: "manual",
    document_type: "sa_id",
    document_storage_path: path,
    id_number: idNumberRaw,
  });

  if (insertError) {
    await supabase.storage.from("verification-documents").remove([path]);
    return { error: "Could not submit your verification. Please try again." };
  }

  revalidatePath("/account/verification");
  return null;
}
