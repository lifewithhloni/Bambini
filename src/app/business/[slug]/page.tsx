import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessStorefront } from "@/server/business/getBusinessStorefront";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImageOff, Star, MapPin, Check, ShoppingBag } from "@/components/ui/icons";

// Public storefront — never statically cached, since it must always
// reflect current listings and never risk serving a stale "verified"
// state (see getBusinessStorefront()'s own not-found-if-unverified shape).
export const dynamic = "force-dynamic";

/**
 * Only public-safe fields ever reach this page: getBusinessStorefront()
 * reads businesses_public (verified businesses only) and published
 * products — never the owner id, member list, registration/VAT numbers,
 * verification records, or a private address. The verified badge is
 * unconditional here because an unverified business isn't found at all.
 */
export default async function BusinessStorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessStorefront(slug);
  if (!business) notFound();

  const coverPaths = business.listings.map((l) => l.coverImagePath).filter((p): p is string => !!p);
  const imageUrls = coverPaths.length > 0 ? await getSignedImageUrls(coverPaths) : {};

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        {business.logoUrl ? (
          <div className="h-16 w-16 overflow-hidden rounded-full bg-brand-light-sage">
            {/* eslint-disable-next-line @next/next/no-img-element -- an external, business-supplied URL, not a Supabase-signed storage path, so next/image's host allow-list doesn't apply */}
            <img src={business.logoUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <Avatar name={business.businessName} size="lg" />
        )}
        <h1 className="text-heading-page text-brand-ink">{business.businessName}</h1>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Badge tone="success">
            <Check className="h-3 w-3" aria-hidden="true" />
            Verified business
          </Badge>
          {business.ratingCount > 0 && business.ratingAverage !== null && (
            <Badge tone="neutral">
              <Star className="h-3 w-3 fill-bambini-peach text-bambini-peach" aria-hidden="true" />
              {business.ratingAverage.toFixed(1)} ({business.ratingCount})
            </Badge>
          )}
        </div>
        {business.location?.suburb && (
          <p className="flex items-center gap-1 text-body-small text-brand-muted">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {[business.location.suburb, business.location.city].filter(Boolean).join(", ")}
          </p>
        )}
        {business.description && <p className="max-w-prose text-body text-brand-ink">{business.description}</p>}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Listings</h2>
        {business.listings.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No listings yet" description="Check back soon." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {business.listings.map((listing) => {
              const imageUrl = listing.coverImagePath ? (imageUrls[listing.coverImagePath] ?? null) : null;
              return (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="flex flex-col gap-1.5 rounded-card bg-brand-surface p-2 shadow-subtle transition-shadow duration-150 ease-bambini hover:shadow-elevated"
                >
                  <div className="relative aspect-square overflow-hidden rounded-image bg-brand-cream">
                    {imageUrl ? (
                      <Image src={imageUrl} alt="" fill sizes="(min-width: 640px) 200px, 45vw" className="object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-brand-muted">
                        <ImageOff className="h-5 w-5" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <p className="truncate text-body-small text-brand-ink">{listing.title}</p>
                  <p className="text-price text-brand-ink">{formatCentsAsRand(listing.priceCents)}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
