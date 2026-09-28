import { Skeleton, SkeletonAvatar, SkeletonText } from "@/components/ui/Skeleton";

export default function ThreadLoading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 sm:py-12" aria-busy="true" aria-label="Loading conversation">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
        <SkeletonAvatar />
        <SkeletonText lines={2} className="flex-1" />
      </div>
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-12 w-1/2" />
      <Skeleton className="h-28 w-full rounded-card" />
    </div>
  );
}
