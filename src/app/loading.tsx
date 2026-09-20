import { ListingGridSkeleton } from "@/components/listings/ListingGridSkeleton";

export default function HomeLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="mx-auto h-40 w-full max-w-md animate-pulse rounded-lg bg-brand-border" />
      <ListingGridSkeleton count={8} />
    </div>
  );
}
