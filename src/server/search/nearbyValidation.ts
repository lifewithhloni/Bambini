import { z } from "zod";
import { parseRandToCents } from "@/server/listings/price";
import { LISTING_CONDITIONS } from "@/server/listings/validation";
import { parseNearbySortKey } from "./nearbySort";
import { parseRadiusKm } from "./radius";

// Same normalization/leniency conventions as src/server/search/validation.ts
// (searchQuerySchema) — an odd/invalid filter value is dropped rather than
// rejected, since a shared/bookmarked /nearby URL should degrade, not error.
const normalizeEmpty = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const nearbyQuerySchema = z.object({
  radiusKm: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => parseRadiusKm(v)),
  category: z.preprocess(
    normalizeEmpty,
    z
      .string()
      .optional()
      .transform((v) => (v && UUID_PATTERN.test(v.trim()) ? v.trim() : undefined)),
  ),
  condition: z.preprocess(
    normalizeEmpty,
    z
      .string()
      .optional()
      .transform((v) => (v && (LISTING_CONDITIONS as readonly string[]).includes(v) ? (v as (typeof LISTING_CONDITIONS)[number]) : undefined)),
  ),
  minPrice: z.preprocess(
    normalizeEmpty,
    z
      .string()
      .optional()
      .transform((v) => (v ? (parseRandToCents(v) ?? undefined) : undefined)),
  ),
  maxPrice: z.preprocess(
    normalizeEmpty,
    z
      .string()
      .optional()
      .transform((v) => (v ? (parseRandToCents(v) ?? undefined) : undefined)),
  ),
  collection: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => v === "1" || v === "true" || v === "on"),
  delivery: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => v === "1" || v === "true" || v === "on"),
  sort: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => parseNearbySortKey(v)),
  page: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => {
    const n = v ? Number.parseInt(v, 10) : 1;
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 10_000);
  }),
});

export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
