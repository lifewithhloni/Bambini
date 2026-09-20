import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";
import { getCategoryOptions, getCategoryTree } from "@/server/categories/getCategories";
import { categoryNamesById } from "@/server/categories/tree";
import { searchNearby } from "@/server/search/searchNearby";
import { nearbyQuerySchema } from "@/server/search/nearbyValidation";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { NearbyListingGrid } from "@/components/listings/NearbyListingGrid";
import { NearbyFilterForm } from "@/components/search/NearbyFilterForm";
import { Pagination } from "@/components/search/Pagination";

// Depends entirely on the signed-in caller's own saved location and on
// currently-published listings — never statically cached, same reasoning
// as /search.
export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function SetLocationPrompt({ href, label }: { href: string; label: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-brand-ink">Nearby</h1>
      <p className="text-sm text-brand-muted">Set your location to see items near you.</p>
      <Link
        href={href}
        className="rounded-full bg-brand-sage-dark px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-sage"
      >
        {label}
      </Link>
    </div>
  );
}

export default async function NearbyPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getOptionalUser();
  if (!user) {
    return <SetLocationPrompt href="/login?next=/nearby" label="Sign in to browse Nearby" />;
  }

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("location_id").eq("id", user.id).maybeSingle();

  if (!profile?.location_id) {
    return <SetLocationPrompt href="/account/location" label="Set your location" />;
  }

  // Fetched here, used only to build the RPC call below — the buyer's
  // own raw coordinates never reach the rendered page or the browser;
  // search_nearby_products() itself never returns them either (see
  // 20260923090000_nearby_search.sql).
  const { data: myLocation } = await supabase
    .from("locations")
    .select("latitude, longitude")
    .eq("id", profile.location_id)
    .maybeSingle();

  if (!myLocation) {
    return <SetLocationPrompt href="/account/location" label="Set your location" />;
  }

  const raw = await searchParams;
  const query = nearbyQuerySchema.parse({
    radiusKm: firstValue(raw.radiusKm),
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
    searchNearby({
      buyerLat: myLocation.latitude,
      buyerLng: myLocation.longitude,
      radiusKm: query.radiusKm,
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-ink">Nearby</h1>
        <Link href="/account/location" className="text-sm font-medium text-brand-ink hover:underline">
          Change location
        </Link>
      </div>

      <NearbyFilterForm
        action="/nearby"
        categories={categories}
        values={{
          radiusKm: query.radiusKm,
          category: query.category,
          condition: query.condition,
          collection: query.collection,
          delivery: query.delivery,
          sort: query.sort,
        }}
      />

      <p className="text-sm text-brand-muted">
        {result.totalCount} {result.totalCount === 1 ? "listing" : "listings"} within {query.radiusKm} km
      </p>

      <NearbyListingGrid listings={result.listings} imageUrls={imageUrls} categoryNames={categoryNames} />

      <Pagination
        basePath="/nearby"
        currentSearchParams={{
          radiusKm: String(query.radiusKm),
          category: query.category,
          condition: query.condition,
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
