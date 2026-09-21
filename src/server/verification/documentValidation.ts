// Mirrors supabase/config.toml's verification-documents bucket limits
// exactly — keep the two in sync if either changes.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;

export type DocumentFileLike = { type: string; size: number; name?: string };
export type DocumentValidationResult = { ok: true } | { ok: false; error: string };

export function validateDocumentFile(file: DocumentFileLike): DocumentValidationResult {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
    return { ok: false, error: "Upload a PNG, JPEG, or PDF." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "The selected file is empty." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: `The file is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB.` };
  }
  return { ok: true };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

/**
 * The storage path convention the verification-documents RLS policies
 * rely on: "<user-id>/<random-token>/id-document.<ext>" — the leading
 * segment is checked directly against auth.uid() by the storage policy
 * (see 20260928090000_identity_account_verification.sql), so it must
 * always be the real signed-in user's own id, never client-influenced.
 * The random token only exists so repeat submissions never collide.
 */
export function buildVerificationDocumentPath(userId: string, mimeType: string, randomToken: string): string {
  const ext = EXTENSION_BY_MIME[mimeType] ?? "bin";
  return `${userId}/${randomToken}/id-document.${ext}`;
}

/**
 * Phase 6 — the same private verification-documents bucket, namespaced
 * under a literal "business/" first segment so it can never collide
 * with an individual's "<user-id>/..." path above. The storage policies
 * (business_verification_documents_storage_*, see
 * 20260929090000_business_onboarding_storefront.sql) check this exact
 * shape: segment[1] = 'business', segment[2] = the business id, gated
 * by is_business_member().
 */
export function buildBusinessVerificationDocumentPath(businessId: string, mimeType: string, randomToken: string): string {
  const ext = EXTENSION_BY_MIME[mimeType] ?? "bin";
  return `business/${businessId}/${randomToken}/document.${ext}`;
}
