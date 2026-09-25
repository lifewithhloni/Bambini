export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-busy="true" aria-label="Loading listings">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-card bg-brand-surface p-2 shadow-card">
          <div className="aspect-square w-full animate-pulse rounded-image bg-brand-border" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-brand-border" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-brand-border" />
        </div>
      ))}
    </div>
  );
}
