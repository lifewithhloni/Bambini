import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function MyOrdersLoading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <Skeleton className="h-7 w-32" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-14 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading your orders">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
            <Skeleton className="h-16 w-16 shrink-0 rounded-image" />
            <div className="flex flex-1 flex-col justify-center gap-2">
              <SkeletonText lines={2} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
