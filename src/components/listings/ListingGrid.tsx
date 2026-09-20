import { ProductCard } from "./ProductCard";
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
    return (
      <div className="rounded-lg border border-dashed border-brand-border px-4 py-10 text-center text-sm text-brand-muted">
        {emptyMessage}
      </div>
    );
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
