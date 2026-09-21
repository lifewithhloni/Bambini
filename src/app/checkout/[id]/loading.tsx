export default function CheckoutLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="h-7 w-40 animate-pulse rounded bg-brand-border" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-brand-border" />
      <div className="h-16 w-full animate-pulse rounded-lg bg-brand-border" />
      <div className="h-12 w-full animate-pulse rounded-full bg-brand-border" />
    </div>
  );
}
