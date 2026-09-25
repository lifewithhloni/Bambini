export type PageShellWidth = "sm" | "md" | "lg" | "xl" | "full";

const WIDTHS: Record<PageShellWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-none",
};

/**
 * The reusable content-width + gutter wrapper future pages (Home,
 * Browse, Search, Product detail, ...) will use once they're built —
 * NOT applied globally in the root layout, since existing pages
 * already each choose their own width today (an account page is
 * `max-w-sm`, an admin table is `max-w-4xl`/`max-w-5xl`) and forcing a
 * single global wrapper would double up padding or squeeze wide admin
 * tables. `width` picks the same handful of container sizes already
 * used ad hoc across the app, now as one named scale instead of a
 * repeated raw `max-w-*` per page. Bottom padding on mobile always
 * reserves space for BottomNav (see layout.tsx) plus the safe-area
 * inset, so content is never hidden behind it.
 */
export function PageShell({
  width = "sm",
  className = "",
  children,
}: {
  width?: PageShellWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 ${WIDTHS[width]} ${className}`}>{children}</div>
  );
}
