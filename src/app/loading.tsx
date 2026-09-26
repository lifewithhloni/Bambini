import { Skeleton } from "@/components/ui/Skeleton";
import { ListingGridSkeleton } from "@/components/listings/ListingGridSkeleton";

export default function HomeLoading() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Loading Bambini">
      <div className="bg-brand-cream px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-80 max-w-full" />
          <Skeleton className="h-11 w-full max-w-md rounded-input" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <div className="flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-16 shrink-0 rounded-full" />
          ))}
        </div>
        <ListingGridSkeleton count={8} />
      </div>
    </div>
  );
}
