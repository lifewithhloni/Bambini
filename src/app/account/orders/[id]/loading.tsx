import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function OrderDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <Skeleton className="h-7 w-36" />
      <div className="flex items-center justify-between">
        <SkeletonText lines={2} className="w-1/2" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="flex gap-3 rounded-card border border-brand-border bg-brand-surface p-4">
        <Skeleton className="h-20 w-20 shrink-0 rounded-image" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-20 w-full rounded-card" />
      <Skeleton className="h-13 w-full rounded-button" />
    </div>
  );
}
