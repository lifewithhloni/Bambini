import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessStorefront } from "@/server/business/getBusinessStorefront";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";

// Public storefront — never statically cached, since it must always
// reflect current listings and never risk serving a stale "verified"
// state (see getBusinessStorefront()'s own not-found-if-unverified shape).
export const dynamic = "force-dynamic";

export default async function BusinessStorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessStorefront(slug);
  if (!business) notFound();

  const coverPaths = business.listings.map((l) => l.coverImagePath).filter((p): p is string => !!p);
  const imageUrls = coverPaths.length > 0 ? await getSignedImageUrls(coverPaths) : {};

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="h-20 w-20 overflow-hidden rounded-full bg-brand-bg">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an external, business-supplied URL, not a Supabase-signed storage path
            <img src={business.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl text-brand-muted">{business.businessName[0]}</div>
          )}
        </div>
        <h1 className="text-xl font-semibold text-brand-ink">{business.businessName}</h1>
        {business.ratingCount > 0 && (
          <p className="text-sm text-brand-muted">
            {business.ratingAverage?.toFixed(1)} ★ ({business.ratingCount})
          </p>
        )}
        {business.location?.suburb && (
          <p className="text-sm text-brand-muted">{[business.location.suburb, business.location.city].filter(Boolean).join(", ")}</p>
        )}
        {business.description && <p className="text-sm text-brand-ink">{business.description}</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-brand-ink">Listings</h2>
        {business.listings.length === 0 ? (
          <p className="text-sm text-brand-muted">No listings yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {business.listings.map((listing) => {
              const imageUrl = listing.coverImagePath ? (imageUrls[listing.coverImagePath] ?? null) : null;
              return (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-2 hover:bg-brand-bg"
                >
                  <div className="aspect-square overflow-hidden rounded-md bg-brand-bg">
                    {imageUrl ? (
                      <Image src={imageUrl} alt="" width={160} height={160} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-brand-muted">No photo</div>
                    )}
                  </div>
                  <p className="truncate text-xs text-brand-ink">{listing.title}</p>
                  <p className="text-xs font-semibold text-brand-ink">{formatCentsAsRand(listing.priceCents)}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
