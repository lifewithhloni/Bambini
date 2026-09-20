import { createClient } from "@/lib/supabase/server";
import type { ListingCondition } from "@/server/listings/validation";
import type { NearbySortKey } from "./nearbySort";
import type { RadiusKm } from "./radius";
import { PAGE_SIZE, offsetFor, totalPagesFor } from "./pagination";

export type NearbyFilters = {
  buyerLat: number;
  buyerLng: number;
  radiusKm: RadiusKm;
  categoryIds?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  condition?: ListingCondition;
  collectionOnly?: boolean;
  deliveryOnly?: boolean;
  sort: NearbySortKey;
  page: number;
};

export type NearbyListingSummary = {
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
  distance_km: number;
  suburb: string | null;
  city: string | null;
};

export type NearbyResult = {
  listings: NearbyListingSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const EMPTY_RESULT = (page: number): NearbyResult => ({
  listings: [],
  totalCount: 0,
  page,
  pageSize: PAGE_SIZE,
  totalPages: 1,
});

/**
 * The single entry point the /nearby UI goes through — a thin, typed
 * wrapper around the search_nearby_products() RPC (see the Phase 3B
 * migration), mirroring searchListings()'s own shape and conventions
 * exactly. buyerLat/buyerLng are always the caller's own saved location
 * (resolved server-side from profiles.location_id before this is
 * called — see src/app/nearby/page.tsx), never a client-supplied
 * coordinate pair for an arbitrary point. `categoryIds` here is expected
 * to already be resolved (self-or-descendant leaf ids), same contract as
 * searchListings().
 */
export async function searchNearby(filters: NearbyFilters): Promise<NearbyResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("search_nearby_products", {
    buyer_lat: filters.buyerLat,
    buyer_lng: filters.buyerLng,
    radius_km: filters.radiusKm,
    category_ids: filters.categoryIds && filters.categoryIds.length > 0 ? filters.categoryIds : null,
    min_price_cents: filters.minPriceCents ?? null,
    max_price_cents: filters.maxPriceCents ?? null,
    condition_filter: filters.condition ?? null,
    collection_only: filters.collectionOnly ?? false,
    delivery_only: filters.deliveryOnly ?? false,
    sort_key: filters.sort,
    page_size: PAGE_SIZE,
    page_offset: offsetFor(filters.page, PAGE_SIZE),
  });

  if (error || !data) return EMPTY_RESULT(filters.page);

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
      distance_km: row.distance_km,
      suburb: row.suburb,
      city: row.city,
    })),
    totalCount,
    page: filters.page,
    pageSize: PAGE_SIZE,
    totalPages: totalPagesFor(totalCount, PAGE_SIZE),
  };
}
