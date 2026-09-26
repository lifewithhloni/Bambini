import Link from "next/link";
import { iconForCategorySlug } from "@/lib/ui/categoryIcons";
import { LayoutGrid } from "@/components/ui/icons";
import type { CategoryNode } from "@/server/categories/tree";

/**
 * Top-level category shortcuts for Home — real, database-driven
 * top-level nodes from getCategoryTree() (never a hard-coded list; see
 * this phase's own audit). Icons are a purely presentational lookup by
 * slug (categories has no icon column) with a generic fallback, never
 * something a caller has to supply per category. Horizontally
 * scrollable on mobile, wraps naturally at wider widths.
 */
export function CategoryShortcuts({ categories }: { categories: CategoryNode[] }) {
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="list" aria-label="Browse by category">
      {categories.map((category) => {
        const Icon = iconForCategorySlug(category.slug);
        return (
          <Link
            key={category.id}
            href={`/category/${category.slug}`}
            role="listitem"
            className="group flex w-20 shrink-0 flex-col items-center gap-2 sm:w-24"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light-sage text-bambini-forest transition-colors duration-150 ease-bambini group-hover:bg-brand-sage sm:h-16 sm:w-16">
              <Icon className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="text-center text-caption font-medium text-brand-ink">{category.name}</span>
          </Link>
        );
      })}
      <Link href="/search" role="listitem" className="flex w-20 shrink-0 flex-col items-center gap-2 sm:w-24">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-cream text-bambini-charcoal sm:h-16 sm:w-16">
          <LayoutGrid className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="text-center text-caption font-medium text-brand-ink">All categories</span>
      </Link>
    </div>
  );
}
