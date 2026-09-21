import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicListing } from "@/server/listings/getPublicListing";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";
import { ConditionBadge } from "@/components/listings/ConditionBadge";
import { getOptionalUser } from "@/server/auth/requireUser";
import { createClient } from "@/lib/supabase/server";

// A published listing's visibility can change at any time (the seller
// unpublishes it) and it shows another user's live rating — never
// statically cache this across visitors.
export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [listing, viewer] = await Promise.all([getPublicListing(id), getOptionalUser()]);
  if (!listing) notFound();

  const imageUrls = await getSignedImageUrls(listing.images);

  // getPublicListing() deliberately doesn't return seller_profile_id (its
  // own "public" type never carries raw identifiers) — a small separate
  // check here, only ever used to decide whether "Buy now" renders, never
  // the actual purchase authorization (create_order() re-derives and
  // re-checks this itself regardless — see 20260925090000_orders_checkout.sql).
  let isOwnListing = false;
  if (viewer) {
    const supabase = await createClient();
    const { data: product } = await supabase.from("products").select("seller_profile_id").eq("id", id).maybeSingle();
    isOwnListing = product?.seller_profile_id === viewer.id;
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      {listing.images.length > 0 ? (
        <div className="flex snap-x gap-2 overflow-x-auto rounded-lg">
          {listing.images.map((path) =>
            imageUrls[path] ? (
              <Image
                key={path}
                src={imageUrls[path]}
                alt={listing.title}
                width={480}
                height={480}
                className="aspect-square w-full shrink-0 snap-center rounded-lg object-cover"
              />
            ) : null,
          )}
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-brand-border text-brand-muted">
          No photos yet
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-brand-ink">{listing.title}</h1>
          <ConditionBadge condition={listing.condition} />
        </div>
        <p className="text-2xl font-semibold text-brand-ink">{formatCentsAsRand(listing.price_cents)}</p>
        {listing.category && (
          <Link href={`/category/${listing.category.slug}`} className="text-sm text-brand-muted hover:underline">
            {listing.category.name}
          </Link>
        )}
      </div>

      {listing.description && <p className="whitespace-pre-wrap text-brand-ink">{listing.description}</p>}

      <div className="flex flex-wrap gap-2 text-sm">
        {listing.collection_available && (
          <span className="rounded-full bg-brand-sage/20 px-3 py-1 text-brand-ink">Free collection</span>
        )}
        {listing.delivery_available && (
          <span className="rounded-full bg-brand-sage/20 px-3 py-1 text-brand-ink">Delivery available</span>
        )}
      </div>

      {listing.location?.suburb && (
        <p className="text-sm text-brand-muted">{[listing.location.suburb, listing.location.city].filter(Boolean).join(", ")}</p>
      )}

      {listing.seller && (
        <div className="flex items-center justify-between rounded-lg border border-brand-border bg-white px-4 py-3">
          <div>
            <p className="text-sm font-medium text-brand-ink">{listing.seller.name}</p>
            {listing.seller.rating_count > 0 && listing.seller.rating_average !== null ? (
              <p className="text-xs text-brand-muted">
                {listing.seller.rating_average.toFixed(1)} ★ ({listing.seller.rating_count} review
                {listing.seller.rating_count === 1 ? "" : "s"})
              </p>
            ) : (
              <p className="text-xs text-brand-muted">No reviews yet</p>
            )}
          </div>
        </div>
      )}

      {!isOwnListing && (
        <Link
          href={viewer ? `/checkout/${listing.id}` : `/login?next=${encodeURIComponent(`/checkout/${listing.id}`)}`}
          className="w-full rounded-full bg-brand-sage-dark px-4 py-3 text-center text-sm font-medium text-white hover:bg-brand-sage"
        >
          Buy now
        </Link>
      )}
    </div>
  );
}
