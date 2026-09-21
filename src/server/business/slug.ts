// Mirrors businesses_slug_format (supabase/migrations/20260929090000_business_onboarding_storefront.sql):
// lowercase alphanumeric segments joined by single hyphens, never a
// leading/trailing/double hyphen.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Best-effort suggestion only — the user can still edit it, and the database is what actually enforces the format + uniqueness. */
export function slugify(businessName: string): string {
  return businessName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
