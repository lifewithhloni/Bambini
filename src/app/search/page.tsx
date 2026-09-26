import { getCategoryOptions, getCategoryTree } from "@/server/categories/getCategories";
import { categoryNamesById } from "@/server/categories/tree";
import { searchListings } from "@/server/search/searchListings";
import { searchQuerySchema, firstValue } from "@/server/search/validation";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { centsToRandInput } from "@/server/listings/price";
import { ListingGrid } from "@/components/listings/ListingGrid";
import { FilterForm } from "@/components/search/FilterForm";
import { Pagination } from "@/components/search/Pagination";

// A search result depends entirely on the query string and on
// currently-published listings, which can change at any moment —
// never statically cached.
export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const query = searchQuerySchema.parse({
    q: firstValue(raw.q),
    category: firstValue(raw.category),
    condition: firstValue(raw.condition),
    minPrice: firstValue(raw.minPrice),
    maxPrice: firstValue(raw.maxPrice),
    collection: firstValue(raw.collection),
    delivery: firstValue(raw.delivery),
    sort: firstValue(raw.sort),
    page: firstValue(raw.page),
  });

  const [categories, tree, result] = await Promise.all([
    getCategoryOptions(),
    getCategoryTree(),
    searchListings({
      q: query.q,
      categoryIds: query.category ? [query.category] : undefined,
      minPriceCents: query.minPrice,
      maxPriceCents: query.maxPrice,
      condition: query.condition,
      collectionOnly: query.collection,
      deliveryOnly: query.delivery,
      sort: query.sort,
      page: query.page,
    }),
  ]);

  const coverPaths = result.listings.map((l) => l.cover_image_path).filter((p): p is string => !!p);
  const [imageUrls, categoryNames] = await Promise.all([
    getSignedImageUrls(coverPaths),
    Promise.resolve(categoryNamesById(tree)),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-heading-page text-brand-ink">{query.q ? `Results for "${query.q}"` : "Explore"}</h1>

      <FilterForm
        action="/search"
        showSearchInput
        showCategorySelect
        categories={categories}
        values={{
          q: query.q,
          category: query.category,
          condition: query.condition,
          minPrice: query.minPrice !== undefined ? centsToRandInput(query.minPrice) : undefined,
          maxPrice: query.maxPrice !== undefined ? centsToRandInput(query.maxPrice) : undefined,
          collection: query.collection,
          delivery: query.delivery,
          sort: query.sort,
        }}
      />

      <p className="text-body-small text-brand-muted">
        {result.totalCount} {result.totalCount === 1 ? "listing" : "listings"} found
      </p>

      <ListingGrid listings={result.listings} imageUrls={imageUrls} categoryNames={categoryNames} />

      <Pagination
        basePath="/search"
        currentSearchParams={{
          q: query.q,
          category: query.category,
          condition: query.condition,
          minPrice: raw.minPrice ? firstValue(raw.minPrice) : undefined,
          maxPrice: raw.maxPrice ? firstValue(raw.maxPrice) : undefined,
          collection: query.collection ? "1" : undefined,
          delivery: query.delivery ? "1" : undefined,
          sort: query.sort,
        }}
        page={result.page}
        totalPages={result.totalPages}
      />
    </div>
  );
}
