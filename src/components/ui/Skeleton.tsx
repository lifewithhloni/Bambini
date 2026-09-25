/** A generic pulse-loading placeholder block — compose with width/height utilities via className. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-input bg-brand-border ${className}`} />;
}

export function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3.5 animate-pulse rounded bg-brand-border ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ className = "h-11 w-11" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-full bg-brand-border ${className}`} />;
}
