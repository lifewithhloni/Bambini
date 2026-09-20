import { z } from "zod";
import { parseRandToCents } from "@/server/listings/price";
import { LISTING_CONDITIONS } from "@/server/listings/validation";
import { parseSortKey } from "./sort";

// Next.js hands a route's `searchParams` in as plain strings (or
// undefined for a missing key — never `null`, unlike FormData.get()),
// but this still normalizes an empty string the same way, since
// "?minPrice=" is a real, reachable URL a user can type or share.
const normalizeEmpty = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An invalid/unparseable value for an optional filter (a mistyped
 * price, an unknown condition) is silently dropped rather than
 * rejected — a shared/bookmarked search URL should never break with an
 * error page just because one filter looks odd; it should just not
 * apply that filter. `sort` is the one exception that always resolves
 * to *something* valid (defaults to "newest") rather than being
 * droppable, since every search has to sort by something.
 */
export const searchQuerySchema = z.object({
  q: z.preprocess(normalizeEmpty, z.string().trim().max(200).optional()),
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
  sort: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => parseSortKey(v)),
  page: z.preprocess(normalizeEmpty, z.string().optional()).transform((v) => {
    const n = v ? Number.parseInt(v, 10) : 1;
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 10_000); // a page number this high will just return an empty result set — clamped so it can't be used to force a huge OFFSET computation
  }),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** searchParams from Next.js can hand a param as string | string[] | undefined (repeated query keys) — this takes the first value for anything we only ever expect once. */
export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
