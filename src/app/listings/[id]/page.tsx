import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicListing } from "@/server/listings/getPublicListing";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";
import { ConditionBadge } from "@/components/listings/ConditionBadge";
import { SellerCard } from "@/components/listings/SellerCard";
import { Badge } from "@/components/ui/Badge";
import { ImageOff, ChevronLeft } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <Link href="/search" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to browsing
      </Link>

      {listing.images.length > 0 ? (
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-card-lg">
          {listing.images.map((path) =>
            imageUrls[path] ? (
              <Image
                key={path}
                src={imageUrls[path]}
                alt={listing.title}
                width={640}
                height={640}
                className="aspect-square w-full shrink-0 snap-center object-cover"
              />
            ) : null,
          )}
        </div>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-card-lg bg-brand-cream text-brand-muted">
          <ImageOff className="h-8 w-8" aria-hidden="true" />
          <span className="text-body-small">No photos yet</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-heading-page text-brand-ink">{listing.title}</h1>
          <ConditionBadge condition={listing.condition} />
        </div>
        <p className="text-price text-2xl text-brand-ink">{formatCentsAsRand(listing.price_cents)}</p>
        {listing.category && (
          <Link href={`/category/${listing.category.slug}`} className="text-body-small text-brand-muted hover:text-bambini-forest hover:underline">
            {listing.category.name}
          </Link>
        )}
      </div>

      {listing.description && <p className="whitespace-pre-wrap text-body text-brand-ink">{listing.description}</p>}

      <div className="flex flex-wrap gap-2">
        {listing.collection_available && <Badge tone="success">Free collection</Badge>}
        {listing.delivery_available && <Badge tone="success">Delivery available</Badge>}
      </div>

      {listing.location?.suburb && (
        <p className="text-body-small text-brand-muted">{[listing.location.suburb, listing.location.city].filter(Boolean).join(", ")}</p>
      )}

      {listing.seller && (
        <SellerCard
          name={listing.seller.name}
          avatarUrl={listing.seller.avatarUrl}
          isVerified={listing.seller.isVerified}
          ratingAverage={listing.seller.rating_count > 0 ? listing.seller.rating_average : null}
          ratingCount={listing.seller.rating_count}
          subtitle={listing.seller.rating_count === 0 ? "No reviews yet" : undefined}
        />
      )}

      {!isOwnListing && (
        <Link
          href={viewer ? `/checkout/${listing.id}` : `/login?next=${encodeURIComponent(`/checkout/${listing.id}`)}`}
          className={buttonVariants({ variant: "primary", size: "lg", fullWidth: true })}
        >
          Buy now
        </Link>
      )}
    </div>
  );
}
