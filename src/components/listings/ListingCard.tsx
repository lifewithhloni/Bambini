import Image from "next/image";
import Link from "next/link";
import { formatCentsAsRand } from "@/server/listings/price";
import { StatusBadge } from "./StatusBadge";
import type { MyListing } from "@/server/listings/getMyListings";

export function ListingCard({ listing, imageUrl }: { listing: MyListing; imageUrl: string | null }) {
  return (
    <Link
      href={`/sell/${listing.id}/edit`}
      className="flex gap-3 rounded-lg border border-brand-border bg-white p-3 hover:border-brand-sage-dark"
    >
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-brand-bg">
        {imageUrl ? (
          <Image src={imageUrl} alt="" width={80} height={80} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-brand-muted">No photo</div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium text-brand-ink">{listing.title}</p>
          <StatusBadge status={listing.status} />
        </div>
        <p className="text-sm text-brand-ink">{formatCentsAsRand(listing.price_cents)}</p>
        <p className="text-xs text-brand-muted">
          {listing.seller_type === "business" ? "Business listing" : "Personal listing"}
        </p>
      </div>
    </Link>
  );
}
