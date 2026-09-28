import { Skeleton } from "@/components/ui/Skeleton";
import { ListingGridSkeleton } from "@/components/listings/ListingGridSkeleton";

export default function SavedItemsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-40" />
      <ListingGridSkeleton count={6} />
    </div>
  );
}
