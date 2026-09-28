import Image from "next/image";
import Link from "next/link";
import { formatCentsAsRand } from "@/server/listings/price";
import { StatusBadge } from "./StatusBadge";
import { conditionLabel } from "./ConditionBadge";
import { ImageOff } from "@/components/ui/icons";
import type { MyListing } from "@/server/listings/getMyListings";

export function ListingCard({ listing, imageUrl }: { listing: MyListing; imageUrl: string | null }) {
  return (
    <Link
      href={`/sell/${listing.id}/edit`}
      className="flex gap-3 rounded-card bg-brand-surface p-3 shadow-subtle transition-shadow duration-150 ease-bambini hover:shadow-elevated"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-image bg-brand-cream">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill sizes="80px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-brand-muted">
            <ImageOff className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-body-small font-medium text-brand-ink">{listing.title}</p>
          <StatusBadge status={listing.status} />
        </div>
        <p className="text-price text-brand-ink">{formatCentsAsRand(listing.price_cents)}</p>
        <p className="text-caption text-brand-muted">
          {conditionLabel(listing.condition)} · {listing.seller_type === "business" ? "Business" : "Personal"} · Updated{" "}
          {new Date(listing.updated_at).toLocaleDateString()}
        </p>
      </div>
    </Link>
  );
}
