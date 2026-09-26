import { Skeleton } from "@/components/ui/Skeleton";
import { ListingGridSkeleton } from "@/components/listings/ListingGridSkeleton";

export default function SearchLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8" aria-busy="true" aria-label="Loading search results">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-40 w-full rounded-card" />
      <Skeleton className="h-4 w-32" />
      <ListingGridSkeleton count={12} />
    </div>
  );
}
