import { Skeleton, SkeletonAvatar, SkeletonText } from "@/components/ui/Skeleton";

export default function AccountLoading() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12" aria-busy="true" aria-label="Loading your account">
      <div className="flex items-center gap-4">
        <SkeletonAvatar className="h-16 w-16" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
      </div>
      <Skeleton className="h-32 w-full rounded-card" />
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-36 w-full rounded-card" />
      <SkeletonText lines={3} />
    </div>
  );
}
