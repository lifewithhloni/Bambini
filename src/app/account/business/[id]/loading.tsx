import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function BusinessSectionLoading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-5 w-40 rounded-full" />
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-16 flex-1 rounded-card" />
        <Skeleton className="h-16 flex-1 rounded-card" />
        <Skeleton className="h-16 flex-1 rounded-card" />
      </div>
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
            <Skeleton className="h-16 w-16 shrink-0 rounded-image" />
            <SkeletonText lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
