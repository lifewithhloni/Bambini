import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function CheckoutLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 w-40" />
      <div className="flex gap-3 rounded-card border border-brand-border bg-brand-surface p-4">
        <Skeleton className="h-20 w-20 shrink-0 rounded-image" />
        <div className="flex flex-1 flex-col justify-center gap-2">
          <SkeletonText lines={2} />
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
        <Skeleton className="h-11 w-11 rounded-full" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-13 w-full rounded-button" />
    </div>
  );
}
