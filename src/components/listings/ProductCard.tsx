import Image from "next/image";
import Link from "next/link";
import { formatCentsAsRand } from "@/server/listings/price";
import { conditionLabel } from "./ConditionBadge";
import { FavoriteButton } from "./FavoriteButton";
import { ImageOff } from "@/components/ui/icons";
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
 *
 * `sellerName`/`isFavorited`/`onToggleFavorite` are all optional and
 * additive — every existing caller (ListingGrid, NearbyListingGrid,
 * search results) keeps working unchanged, since none of them pass
 * these yet. The favourite heart only renders when both `isFavorited`
 * and `onToggleFavorite` are supplied together, so this card never
 * implies a save/favourites feature that doesn't actually exist
 * anywhere in the backend yet.
 */
export function ProductCard({
  listing,
  imageUrl,
  categoryName,
  distanceLabel,
  sellerName,
  isFavorited,
  onToggleFavorite,
}: {
  listing: ListingSummary;
  imageUrl: string | null;
  categoryName?: string;
  /** Pre-formatted (see src/server/search/distance.ts), Nearby-only — never a raw number, never derived here. */
  distanceLabel?: string;
  sellerName?: string;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
}) {
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group flex flex-col gap-2 rounded-card bg-brand-surface p-2 shadow-card transition-shadow duration-150 ease-bambini hover:shadow-elevated"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-image bg-brand-cream">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={listing.title}
            width={300}
            height={300}
            className="h-full w-full object-cover transition-transform duration-200 ease-bambini group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-brand-muted">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
            <span className="text-caption">No photo</span>
          </div>
        )}
        {isFavorited !== undefined && onToggleFavorite && (
          <FavoriteButton isFavorited={isFavorited} onToggle={onToggleFavorite} label={isFavorited ? `Remove ${listing.title} from saved items` : `Save ${listing.title}`} />
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <p className="truncate text-body-small font-medium text-brand-ink">{listing.title}</p>
        <p className="text-price text-brand-ink">{formatCentsAsRand(listing.price_cents)}</p>
        <div className="flex flex-wrap items-center gap-1 text-caption text-brand-muted">
          <span>{conditionLabel(listing.condition)}</span>
          {categoryName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{categoryName}</span>
            </>
          )}
        </div>
        {sellerName && <p className="truncate text-caption text-brand-muted">{sellerName}</p>}
        {distanceLabel && <p className="text-caption font-medium text-bambini-forest">{distanceLabel}</p>}
        <div className="mt-0.5 flex flex-wrap gap-1">
          {listing.collection_available && (
            <span className="rounded-full bg-brand-light-sage px-2 py-0.5 text-[11px] text-brand-ink">Free collection</span>
          )}
          {listing.delivery_available && (
            <span className="rounded-full bg-brand-light-sage px-2 py-0.5 text-[11px] text-brand-ink">Delivery</span>
          )}
        </div>
      </div>
    </Link>
  );
}
