// Mirrors supabase/config.toml's product-images bucket limits exactly —
// keep the two in sync if either changes.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGES_PER_LISTING = 8;

export type ImageFileLike = { type: string; size: number; name?: string };

export type ImageValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Takes a minimal {type, size} shape rather than a real File/Blob so
 * this is trivially unit-testable without a browser/Node File polyfill,
 * and so the exact same check can run both client-side (UX) and
 * server-side (authoritative) against the same File object's own
 * .type/.size properties.
 */
export function validateImageFile(file: ImageFileLike): ImageValidationResult {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    return { ok: false, error: `${file.name ?? "File"} must be a PNG, JPEG, or WEBP image.` };
  }
  if (file.size <= 0) {
    return { ok: false, error: `${file.name ?? "File"} is empty.` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `${file.name ?? "File"} is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)}MB.` };
  }
  return { ok: true };
}

export function validateImageCount(existingCount: number, addingCount: number): ImageValidationResult {
  if (addingCount <= 0) return { ok: true };
  if (existingCount + addingCount > MAX_IMAGES_PER_LISTING) {
    return { ok: false, error: `A listing can have at most ${MAX_IMAGES_PER_LISTING} photos.` };
  }
  return { ok: true };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The storage path convention every product-images RLS policy relies on: "<product_id>/<random>.<ext>". */
export function buildImageStoragePath(productId: string, mimeType: string, randomId: string): string {
  const ext = EXTENSION_BY_MIME[mimeType] ?? "bin";
  return `${productId}/${randomId}.${ext}`;
}
