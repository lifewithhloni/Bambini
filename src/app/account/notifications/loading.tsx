import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12" aria-busy="true" aria-label="Loading your notifications">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-44" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-card border border-brand-border bg-brand-surface p-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <SkeletonText lines={2} className="flex-1" />
        </div>
      ))}
    </div>
  );
}
