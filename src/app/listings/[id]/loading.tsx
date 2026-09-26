import { Skeleton, SkeletonText, SkeletonAvatar } from "@/components/ui/Skeleton";

export default function ListingLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10" aria-busy="true" aria-label="Loading listing">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="aspect-square w-full rounded-card-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-6 w-24" />
      </div>
      <SkeletonText lines={3} />
      <div className="flex items-center gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
        <SkeletonAvatar />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-13 w-full rounded-button" />
    </div>
  );
}
