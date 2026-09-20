import Image from "next/image";
import Link from "next/link";
import { getCategoryTree } from "@/server/categories/getCategories";
import { categoryNamesById } from "@/server/categories/tree";
import { searchListings } from "@/server/search/searchListings";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { ListingGrid } from "@/components/listings/ListingGrid";

// The "recently listed" teaser and category nav are both live,
// visitor-independent reads of published data — but images are served
// via short-lived signed URLs (see imageUrls.ts), so this can't be
// statically cached indefinitely either way.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [tree, recent] = await Promise.all([
    getCategoryTree(),
    searchListings({ sort: "newest", page: 1, pageSize: 8 }),
  ]);

  const coverPaths = recent.listings.map((l) => l.cover_image_path).filter((p): p is string => !!p);
  const [imageUrls, categoryNames] = await Promise.all([
    getSignedImageUrls(coverPaths),
    Promise.resolve(categoryNamesById(tree)),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-4 bg-brand-bg px-6 py-12 text-center sm:py-16">
        <Image src="/bambini-logo.png" alt="Bambini — For every little beginning" width={96} height={96} priority className="h-20 w-20 sm:h-24 sm:w-24" />
        <h1 className="max-w-md text-2xl font-semibold text-brand-ink sm:text-3xl">
          Buy and sell baby &amp; kids products
        </h1>
        <p className="max-w-sm text-brand-muted">Good things, passed on. Find what you need or sell what you&apos;ve outgrown.</p>

        <form action="/search" method="get" className="mt-2 flex w-full max-w-md gap-2">
          <input
            type="text"
            name="q"
            placeholder="What are you looking for?"
            aria-label="Search"
            className="w-full rounded-full border border-brand-border bg-white px-4 py-2.5 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-brand-sage-dark px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-sage"
          >
            Search
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/sell/new"
            className="rounded-full border border-brand-sage-dark px-5 py-2 text-sm font-medium text-brand-ink hover:bg-white"
          >
            + Sell something
          </Link>
          <Link href="/nearby" className="text-sm font-medium text-brand-ink hover:underline">
            Browse what&apos;s nearby →
          </Link>
        </div>
      </section>

      <section className="border-t border-brand-border px-4 py-6 sm:px-6">
        <h2 className="mb-3 text-sm font-medium text-brand-muted">Browse categories</h2>
        <div className="flex flex-wrap gap-2">
          {tree.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="rounded-full border border-brand-border bg-white px-4 py-2 text-sm text-brand-ink hover:border-brand-sage-dark"
            >
              {category.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="flex-1 border-t border-brand-border px-4 py-6 sm:px-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-brand-muted">Recently listed</h2>
          <Link href="/search?sort=newest" className="text-sm font-medium text-brand-ink hover:underline">
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
    </div>
  );
}
