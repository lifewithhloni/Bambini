// Mirrors the verification-documents bucket's actual file_size_limit
// exactly (20261015090000_identity_verification_privacy_and_size.sql) —
// keep the two in sync if either changes. 2097152 bytes = 2 MiB exactly.
// This bucket is shared with business verification documents
// (submitBusinessVerification.ts reuses validateDocumentFile() directly),
// so this limit necessarily applies to both document types — the
// storage engine itself enforces one file_size_limit per bucket, not
// per path prefix, so a mismatched, more-generous constant here would
// just mean a confusing storage-engine rejection after this check
// already said "fine."
export const MAX_DOCUMENT_BYTES = 2097152;
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
    return { ok: false, error: "The file is larger than 2 MB." };
  }
  return { ok: true };
}

const DIACRITICS_PATTERN = /[̀-ͯ]/g;
// Allowlist, not a denylist — the output can only ever contain ASCII
// letters/digits, so it can never contain '.', '/', '\', or anything
// else that could be read as a path-traversal or path-structure
// character, regardless of what's in the raw name.
const NON_ALPHANUMERIC_PATTERN = /[^A-Za-z0-9]/g;
const MAX_NAME_TOKEN_LENGTH = 40;
const FALLBACK_BASE_NAME = "verified_user";

function sanitizeNameToken(raw: string): string {
  return raw.normalize("NFKD").replace(DIACRITICS_PATTERN, "").replace(NON_ALPHANUMERIC_PATTERN, "").slice(0, MAX_NAME_TOKEN_LENGTH);
}

/**
 * The base for a verification document's storage folder — never the
 * numeric suffix (that's allocated server-side, see
 * allocate_verification_folder_slug() in
 * 20261015090000_identity_verification_privacy_and_size.sql, which is
 * also the actual authorization boundary going forward, not this
 * string). Takes the profile's own full_name — never an ID number,
 * phone number, or email, and the caller is responsible for that by only
 * ever passing full_name in. Diacritics are stripped rather than
 * rejected (an accented name shouldn't fail here), and everything else
 * that isn't an ASCII letter or digit is dropped outright — spaces,
 * apostrophes, punctuation, hyphens, emoji, path-meaningful characters,
 * all of it. A name with only a first word (or one that sanitizes to
 * nothing at all) still produces a safe, non-empty base rather than an
 * empty path segment.
 */
export function sanitizeFullNameForStoragePath(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words.length > 0 ? sanitizeNameToken(words[0]) : "";
  const last = words.length > 1 ? sanitizeNameToken(words[words.length - 1]) : "";
  const tokens = [first, last].filter((t) => t.length > 0);
  return tokens.length > 0 ? tokens.join("_") : FALLBACK_BASE_NAME;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

/**
 * folderName must be a value already returned by
 * allocate_verification_folder_slug() (see submitIdentityVerification.ts)
 * — that RPC, not this function, is the actual authorization boundary
 * (20261015090000_identity_verification_privacy_and_size.sql rewrote the
 * storage.objects policies to check the path's leading segment against
 * verification_folder_slugs, not against this string directly). This
 * function only ever joins an already-validated folder name to a
 * filename; it performs no sanitization of its own and must never be
 * called with client-supplied, un-allocated input.
 */
export function buildVerificationDocumentPath(folderName: string, mimeType: string): string {
  const ext = EXTENSION_BY_MIME[mimeType] ?? "bin";
  return `${folderName}/id-document.${ext}`;
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
