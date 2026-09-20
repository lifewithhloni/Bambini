export const PAGE_SIZE = 24;

/** Offset-based pagination — deterministic because search_products() always orders by created_at/price plus `id desc` as a final tiebreaker (see the migration), so no two rows ever compare equal and no page can skip or repeat a row. Documented for later: cursor pagination would be worth switching to if the catalogue grows large enough that a high page number's OFFSET becomes an expensive scan — not a concern at this phase's scale. */
export function offsetFor(page: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(page - 1, 0) * pageSize;
}

export function totalPagesFor(totalCount: number, pageSize: number = PAGE_SIZE): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

/** Clamps a requested page into the range that actually has results, so a stale/guessed page number in a shared URL degrades to the nearest real page instead of an empty flash. */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 1), Math.max(totalPages, 1));
}
