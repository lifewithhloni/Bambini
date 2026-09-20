import { createClient } from "@/lib/supabase/server";
import type { ListingCondition } from "@/server/listings/validation";
import type { SortKey } from "./sort";
import { PAGE_SIZE, offsetFor, totalPagesFor } from "./pagination";

export type SearchFilters = {
  q?: string;
  categoryIds?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  condition?: ListingCondition;
  collectionOnly?: boolean;
  deliveryOnly?: boolean;
  sort: SortKey;
  page: number;
  /** Overrides PAGE_SIZE — for a small teaser row (e.g. the homepage's "recently listed") that wants fewer rows than a full browse page, without over-fetching. Pagination math (totalPages etc.) still uses this same size. */
  pageSize?: number;
};

export type ListingSummary = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  condition: string;
  category_id: string;
  collection_available: boolean;
  delivery_available: boolean;
  created_at: string;
  cover_image_path: string | null;
};

export type SearchResult = {
  listings: ListingSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const EMPTY_RESULT = (page: number): SearchResult => ({
  listings: [],
  totalCount: 0,
  page,
  pageSize: PAGE_SIZE,
  totalPages: 1,
});

/**
 * The single entry point every browse/search UI (homepage, /search,
 * /category/[slug]) goes through. All the actual filtering/sorting/
 * pagination/visibility logic lives in the `search_products()` Postgres
 * function (see the Phase 3A migration) — this is a thin, typed wrapper
 * that calls it via RPC and shapes the result. A `category_ids` array
 * here is expected to already be resolved (self-or-descendant leaf ids
 * from the category tree) by the caller, not a raw client-supplied
 * category id passed straight through — see
 * src/server/categories/tree.ts's resolveCategoryFilterIds().
 */
export async function searchListings(filters: SearchFilters): Promise<SearchResult> {
  const supabase = await createClient();
  const pageSize = filters.pageSize ?? PAGE_SIZE;

  const { data, error } = await supabase.rpc("search_products", {
    search_term: filters.q ?? null,
    category_ids: filters.categoryIds && filters.categoryIds.length > 0 ? filters.categoryIds : null,
    min_price_cents: filters.minPriceCents ?? null,
    max_price_cents: filters.maxPriceCents ?? null,
    condition_filter: filters.condition ?? null,
    collection_only: filters.collectionOnly ?? false,
    delivery_only: filters.deliveryOnly ?? false,
    sort_key: filters.sort,
    page_size: pageSize,
    page_offset: offsetFor(filters.page, pageSize),
  });

  if (error || !data) return { ...EMPTY_RESULT(filters.page), pageSize };

  const totalCount = data[0]?.total_count ?? 0;

  return {
    listings: data.map((row) => ({
      id: row.id,
      title: row.title,
      price_cents: row.price_cents,
      currency: row.currency,
      condition: row.condition,
      category_id: row.category_id,
      collection_available: row.collection_available,
      delivery_available: row.delivery_available,
      created_at: row.created_at,
      cover_image_path: row.cover_image_path,
    })),
    totalCount,
    page: filters.page,
    pageSize,
    totalPages: totalPagesFor(totalCount, pageSize),
  };
}
