import Link from "next/link";

/**
 * Preserves every current query param except `page` when building the
 * prev/next hrefs, so paging through never drops the active filters.
 */
export function Pagination({
  basePath,
  currentSearchParams,
  page,
  totalPages,
}: {
  basePath: string;
  currentSearchParams: Record<string, string | undefined>;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  function hrefFor(targetPage: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(currentSearchParams)) {
      if (value) params.set(key, value);
    }
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 py-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="rounded-full border border-brand-border px-4 py-2 text-sm text-brand-ink hover:bg-white">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-brand-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className="rounded-full border border-brand-border px-4 py-2 text-sm text-brand-ink hover:bg-white">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
