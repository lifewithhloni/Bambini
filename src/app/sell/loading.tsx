import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function SellDashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex gap-1">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-18 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-9 w-32 rounded-button" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-16 flex-1 rounded-card" />
        <Skeleton className="h-16 flex-1 rounded-card" />
        <Skeleton className="h-16 flex-1 rounded-card" />
      </div>
      <Skeleton className="h-20 w-full rounded-card" />
      <div className="flex flex-col gap-2">
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
