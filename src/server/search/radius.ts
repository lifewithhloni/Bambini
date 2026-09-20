/**
 * The only radius values Nearby ever exposes — matches
 * search_nearby_products()'s own clamped_radius_km allowlist (see the
 * Phase 3B migration), which falls back to the 10 km default for
 * anything else. Kept in sync deliberately, not enforced from one
 * source, since one lives in SQL and one in the app.
 */
export const RADIUS_OPTIONS_KM = [5, 10, 25, 50] as const;
export type RadiusKm = (typeof RADIUS_OPTIONS_KM)[number];

export const DEFAULT_RADIUS_KM: RadiusKm = 10;

export function isValidRadiusKm(value: number): value is RadiusKm {
  return (RADIUS_OPTIONS_KM as readonly number[]).includes(value);
}

/** Never throws — an unrecognized, missing, or malformed value quietly falls back to the default rather than erroring the whole page. */
export function parseRadiusKm(value: string | number | null | undefined): RadiusKm {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (Number.isFinite(n) && isValidRadiusKm(n)) return n;
  return DEFAULT_RADIUS_KM;
}
