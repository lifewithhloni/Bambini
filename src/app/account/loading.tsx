export default function AccountLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-8 px-4 py-12 sm:py-16" aria-busy="true" aria-label="Loading your account">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-40 animate-pulse rounded bg-brand-border" />
        <div className="h-4 w-52 animate-pulse rounded bg-brand-border" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-4 w-full animate-pulse rounded bg-brand-border" />
        <div className="h-4 w-full animate-pulse rounded bg-brand-border" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-brand-border" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="h-10 w-full animate-pulse rounded-lg bg-brand-border" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-brand-border" />
      </div>
    </div>
  );
}
