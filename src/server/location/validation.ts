import { z } from "zod";

// FormData.get() returns null (not undefined) for a missing field — see
// the same normalization in src/server/listings/validation.ts.
const normalizeEmpty = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);

/**
 * Mirrors the DB CHECK constraints on public.locations (latitude between
 * -90 and 90, longitude between -180 and 180) — this is the client-facing
 * copy of that same rule, not a replacement for it; the constraint is the
 * actual enforcement.
 */
const latitudeSchema = z.preprocess(
  normalizeEmpty,
  z
    .string()
    .transform((v) => Number.parseFloat(v))
    .refine((n) => Number.isFinite(n), "Location not captured — try again")
    .refine((n) => n >= -90 && n <= 90, "Location not captured — try again"),
);

const longitudeSchema = z.preprocess(
  normalizeEmpty,
  z
    .string()
    .transform((v) => Number.parseFloat(v))
    .refine((n) => Number.isFinite(n), "Location not captured — try again")
    .refine((n) => n >= -180 && n <= 180, "Location not captured — try again"),
);

// Suburb/city are what every public-facing surface (Nearby cards, the
// product page's product_locations_public row) actually displays — kept
// required so a saved location is never silently blank there. Full
// street address is deliberately not collected this phase (see
// DECISIONS.md): the only place it would ever be shown is back to the
// owner themselves, which isn't built yet.
export const locationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  suburb: z.string().trim().min(1, "Suburb is required").max(120, "Suburb is too long"),
  city: z.string().trim().min(1, "City is required").max(120, "City is too long"),
  province: z.preprocess(normalizeEmpty, z.string().trim().max(120, "Province is too long").optional()).transform((v) => v ?? null),
});

export type LocationInput = z.infer<typeof locationSchema>;
