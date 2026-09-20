import Image from "next/image";
import Link from "next/link";
import { formatCentsAsRand } from "@/server/listings/price";
import { conditionLabel } from "./ConditionBadge";
import type { ListingSummary } from "@/server/search/searchListings";

/**
 * The public browsing card — deliberately different data than the
 * seller-dashboard ListingCard (no status badge, since only published
 * listings ever reach this component; no seller identity beyond what
 * the detail page itself already limits to public-safe fields). Never
 * shown a draft/archived listing: every caller gets its data from
 * search_products()/getPublicListing(), both of which already filter to
 * status = 'published' — this component has no filtering logic of its
 * own to get wrong.
 */
export function ProductCard({
  listing,
  imageUrl,
  categoryName,
  distanceLabel,
}: {
  listing: ListingSummary;
  imageUrl: string | null;
  categoryName?: string;
  /** Pre-formatted (see src/server/search/distance.ts), Nearby-only — never a raw number, never derived here. */
  distanceLabel?: string;
}) {
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-2 hover:border-brand-sage-dark"
    >
      <div className="aspect-square w-full overflow-hidden rounded-md bg-brand-bg">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={listing.title}
            width={300}
            height={300}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-brand-muted">No photo</div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <p className="truncate text-sm font-medium text-brand-ink">{listing.title}</p>
        <p className="text-sm font-semibold text-brand-ink">{formatCentsAsRand(listing.price_cents)}</p>
        <div className="flex flex-wrap items-center gap-1 text-xs text-brand-muted">
          <span>{conditionLabel(listing.condition)}</span>
          {categoryName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{categoryName}</span>
            </>
          )}
        </div>
        {distanceLabel && <p className="text-xs font-medium text-brand-sage-dark">{distanceLabel}</p>}
        <div className="mt-0.5 flex flex-wrap gap-1">
          {listing.collection_available && (
            <span className="rounded-full bg-brand-sage/20 px-2 py-0.5 text-[11px] text-brand-ink">Free collection</span>
          )}
          {listing.delivery_available && (
            <span className="rounded-full bg-brand-sage/20 px-2 py-0.5 text-[11px] text-brand-ink">Delivery</span>
          )}
        </div>
      </div>
    </Link>
  );
}
