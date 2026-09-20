/**
 * Nearby's own sort allowlist — a superset of search_products()'s
 * SORT_OPTIONS (see ./sort.ts) plus "distance", which only makes sense
 * once a reference point exists. Kept as a separate map rather than
 * extending SORT_OPTIONS so regular search's allowlist can't accidentally
 * grow a "distance" option it has no reference point to sort by.
 */
export const NEARBY_SORT_OPTIONS = {
  distance: { label: "Distance: Nearest first" },
  newest: { label: "Newest" },
  price_asc: { label: "Price: Low to High" },
  price_desc: { label: "Price: High to Low" },
} as const;

export type NearbySortKey = keyof typeof NEARBY_SORT_OPTIONS;

export function isValidNearbySortKey(value: string): value is NearbySortKey {
  return Object.prototype.hasOwnProperty.call(NEARBY_SORT_OPTIONS, value);
}

/** Never throws — an unrecognized or missing value quietly falls back to the default rather than erroring the whole page. */
export function parseNearbySortKey(value: string | null | undefined): NearbySortKey {
  if (value && isValidNearbySortKey(value)) return value;
  return "distance";
}
