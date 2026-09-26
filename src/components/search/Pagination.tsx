import Link from "next/link";
import { buttonVariants } from "@/lib/ui/variants";

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
        <Link href={hrefFor(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-body-small text-brand-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
