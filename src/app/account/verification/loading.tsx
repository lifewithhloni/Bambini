import { Skeleton } from "@/components/ui/Skeleton";

export default function VerificationLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12" aria-busy="true" aria-label="Loading verification">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-16 w-full rounded-card" />
      <Skeleton className="h-48 w-full rounded-card" />
    </div>
  );
}
