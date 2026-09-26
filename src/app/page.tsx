import Link from "next/link";
import { getCategoryTree } from "@/server/categories/getCategories";
import { categoryNamesById } from "@/server/categories/tree";
import { searchListings } from "@/server/search/searchListings";
import { searchNearby } from "@/server/search/searchNearby";
import { getMyCoordinates } from "@/server/location/getMyCoordinates";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { ListingGrid } from "@/components/listings/ListingGrid";
import { NearbyListingGrid } from "@/components/listings/NearbyListingGrid";
import { CategoryShortcuts } from "@/components/listings/CategoryShortcuts";
import { SearchInput } from "@/components/ui/SearchInput";
import { buttonVariants } from "@/lib/ui/variants";

// The category nav, "recently listed" teaser, and (for a signed-in
// visitor with a saved location) "near you" teaser are all live reads
// of published data — plus images are served via short-lived signed
// URLs (see imageUrls.ts) — so this can't be statically cached either way.
export const dynamic = "force-dynamic";

const SECTION = "mx-auto w-full max-w-6xl px-4 sm:px-6";

export default async function Home() {
  const coordinates = await getMyCoordinates();

  const [tree, recent, nearby] = await Promise.all([
    getCategoryTree(),
    searchListings({ sort: "newest", page: 1, pageSize: 8 }),
    coordinates
      ? searchNearby({ buyerLat: coordinates.latitude, buyerLng: coordinates.longitude, radiusKm: 25, sort: "distance", page: 1, pageSize: 8 })
      : null,
  ]);

  const allCoverPaths = [
    ...recent.listings.map((l) => l.cover_image_path),
    ...(nearby?.listings.map((l) => l.cover_image_path) ?? []),
  ].filter((p): p is string => !!p);

  const [imageUrls, categoryNames] = await Promise.all([getSignedImageUrls(allCoverPaths), Promise.resolve(categoryNamesById(tree))]);

  return (
    <div className="flex flex-1 flex-col">
      {/* Hero — the visual language from the reference (warm cream
          background, soft rounded search field, forest-green primary
          CTA), an original Bambini layout rather than a pixel copy. No
          fabricated stats (listing/user counts) — this project has no
          analytics table to draw a real number from yet, so none is shown. */}
      <section className="bg-brand-cream px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 text-center">
          <h1 className="text-display text-bambini-charcoal">Pre-loved. Re-loved.</h1>
          <p className="max-w-md text-body text-brand-muted">
            Your child outgrew it. Someone else&apos;s child needs it. Buy and sell baby &amp; kids products near you.
          </p>

          <form action="/search" method="get" className="w-full max-w-md">
            <SearchInput name="q" placeholder="What are you looking for?" aria-label="Search Bambini" />
          </form>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
            <Link href="/search" className={buttonVariants({ variant: "primary" })}>
              Start browsing
            </Link>
            <Link href="/sell/new" className={buttonVariants({ variant: "outline" })}>
              + Sell something
            </Link>
          </div>
        </div>
      </section>

      {/* Category shortcuts — real, database-driven top-level categories. */}
      <section className={`${SECTION} py-8`}>
        <h2 className="mb-4 text-heading-section text-brand-ink">Browse categories</h2>
        <CategoryShortcuts categories={tree} />
      </section>

      {/* Recently listed */}
      <section className={`${SECTION} py-8`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-heading-section text-brand-ink">Recently listed</h2>
          <Link href="/search?sort=newest" className="text-body-small font-medium text-bambini-forest hover:underline">
            See all
          </Link>
        </div>
        <ListingGrid
          listings={recent.listings}
          imageUrls={imageUrls}
          categoryNames={categoryNames}
          emptyMessage="No listings yet — be the first to sell something."
        />
      </section>

      {/* Near you — only for a signed-in visitor with a saved location;
          omitted entirely otherwise rather than prompting for one on the
          homepage (that prompt already lives on /nearby itself). */}
      {nearby && nearby.listings.length > 0 && (
        <section className={`${SECTION} py-8`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-heading-section text-brand-ink">Available around you</h2>
            <Link href="/nearby" className="text-body-small font-medium text-bambini-forest hover:underline">
              See all
            </Link>
          </div>
          <NearbyListingGrid listings={nearby.listings} imageUrls={imageUrls} categoryNames={categoryNames} />
        </section>
      )}
    </div>
  );
}
