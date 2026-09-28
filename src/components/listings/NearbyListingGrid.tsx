import { ProductCard } from "./ProductCard";
import { getFavouriteState } from "@/server/favourites/getFavouriteState";
import { EmptyState } from "@/components/ui/EmptyState";
import { MapPin } from "@/components/ui/icons";
import { formatDistanceKm } from "@/server/search/distance";
import type { NearbyListingSummary } from "@/server/search/searchNearby";

/**
 * Nearby's own grid — a thin wrapper around the same ProductCard every
 * other browse surface uses (see ListingGrid.tsx), just also passing a
 * pre-formatted distance label per card. Distance is computed and rounded
 * entirely in Postgres (search_nearby_products()); this only turns an
 * already-rounded number into display text (see distance.ts) — never
 * recomputes or re-rounds anything client-side.
 */
export async function NearbyListingGrid({
  listings,
  imageUrls,
  categoryNames,
  emptyMessage = "Nothing published near you yet — try a wider radius.",
}: {
  listings: NearbyListingSummary[];
  imageUrls: Record<string, string>;
  categoryNames?: Record<string, string>;
  emptyMessage?: string;
}) {
  if (listings.length === 0) {
    return <EmptyState icon={MapPin} title={emptyMessage} />;
  }

  // One batched read of the viewer's own saved ids for the whole grid (none for
  // a signed-out visitor) — never a per-card query, never anyone else's saves.
  const favourites = await getFavouriteState(listings.map((l) => l.id));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {listings.map((listing) => (
        <ProductCard
          key={listing.id}
          listing={listing}
          imageUrl={listing.cover_image_path ? (imageUrls[listing.cover_image_path] ?? null) : null}
          categoryName={categoryNames?.[listing.category_id]}
          favourite={{ signedIn: favourites.signedIn, initiallySaved: favourites.savedIds.has(listing.id) }}
          distanceLabel={formatDistanceKm(listing.distance_km)}
        />
      ))}
    </div>
  );
}
