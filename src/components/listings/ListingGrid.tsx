import { ProductCard } from "./ProductCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingBag } from "@/components/ui/icons";
import type { ListingSummary } from "@/server/search/searchListings";

export function ListingGrid({
  listings,
  imageUrls,
  categoryNames,
  emptyMessage = "No listings found. Try a different search or filters.",
}: {
  listings: ListingSummary[];
  imageUrls: Record<string, string>;
  categoryNames?: Record<string, string>;
  emptyMessage?: string;
}) {
  if (listings.length === 0) {
    // A single caller-supplied sentence, unchanged from before this
    // phase — every existing call site (page.tsx, NearbyListingGrid's
    // own sibling pattern) already passes one complete message, so this
    // keeps that exact contract rather than splitting it into a
    // title/description pair those callers weren't written for.
    return <EmptyState icon={ShoppingBag} title={emptyMessage} />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {listings.map((listing) => (
        <ProductCard
          key={listing.id}
          listing={listing}
          imageUrl={listing.cover_image_path ? (imageUrls[listing.cover_image_path] ?? null) : null}
          categoryName={categoryNames?.[listing.category_id]}
        />
      ))}
    </div>
  );
}
