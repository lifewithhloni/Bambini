import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryBySlug, getCategoryTree } from "@/server/categories/getCategories";
import { categoryNamesById } from "@/server/categories/tree";
import { searchListings } from "@/server/search/searchListings";
import { searchQuerySchema, firstValue } from "@/server/search/validation";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { centsToRandInput } from "@/server/listings/price";
import { ListingGrid } from "@/components/listings/ListingGrid";
import { FilterForm } from "@/components/search/FilterForm";
import { Pagination } from "@/components/search/Pagination";

export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const raw = await searchParams;
  const query = searchQuerySchema.parse({
    condition: firstValue(raw.condition),
    minPrice: firstValue(raw.minPrice),
    maxPrice: firstValue(raw.maxPrice),
    collection: firstValue(raw.collection),
    delivery: firstValue(raw.delivery),
    sort: firstValue(raw.sort),
    page: firstValue(raw.page),
  });

  const [tree, result] = await Promise.all([
    getCategoryTree(),
    searchListings({
      categoryIds: category.categoryIds,
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
      <div>
        <h1 className="text-heading-page text-brand-ink">{category.node.name}</h1>
        {category.node.children.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {category.node.children.map((child) => (
              <Link
                key={child.id}
                href={`/category/${child.slug}`}
                className="rounded-full border border-brand-border bg-brand-surface px-3 py-1 text-caption text-brand-ink transition-colors duration-150 ease-bambini hover:border-bambini-forest"
              >
                {child.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <FilterForm
        action={`/category/${slug}`}
        values={{
          condition: query.condition,
          minPrice: query.minPrice !== undefined ? centsToRandInput(query.minPrice) : undefined,
          maxPrice: query.maxPrice !== undefined ? centsToRandInput(query.maxPrice) : undefined,
          collection: query.collection,
          delivery: query.delivery,
          sort: query.sort,
        }}
      />

      <p className="text-body-small text-brand-muted">
        {result.totalCount} {result.totalCount === 1 ? "listing" : "listings"} in {category.node.name}
      </p>

      <ListingGrid listings={result.listings} imageUrls={imageUrls} categoryNames={categoryNames} />

      <Pagination
        basePath={`/category/${slug}`}
        currentSearchParams={{
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
