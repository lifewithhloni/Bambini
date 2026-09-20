import { ListingGridSkeleton } from "@/components/listings/ListingGridSkeleton";

export default function NearbyLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="h-7 w-32 animate-pulse rounded bg-brand-border" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-brand-border" />
      <ListingGridSkeleton />
    </div>
  );
}
