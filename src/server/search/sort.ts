/**
 * The only sort options a client can ever select — a client-supplied
 * value is looked up in this map, never interpolated into a query as a
 * column name or direction. `search_products()` (the Postgres function
 * this ultimately calls) enforces the same allowlist again server-side
 * as defense in depth, so even a request that bypassed this layer
 * entirely couldn't reach an arbitrary ORDER BY.
 */
export const SORT_OPTIONS = {
  newest: { label: "Newest" },
  price_asc: { label: "Price: Low to High" },
  price_desc: { label: "Price: High to Low" },
} as const;

export type SortKey = keyof typeof SORT_OPTIONS;

export function isValidSortKey(value: string): value is SortKey {
  return Object.prototype.hasOwnProperty.call(SORT_OPTIONS, value);
}

/** Never throws — an unrecognized or missing value quietly falls back to the default rather than erroring the whole search. */
export function parseSortKey(value: string | null | undefined): SortKey {
  if (value && isValidSortKey(value)) return value;
  return "newest";
}

export const SORT_KEYS = Object.keys(SORT_OPTIONS) as SortKey[];
