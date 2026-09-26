import { SORT_OPTIONS, type SortKey } from "@/server/search/sort";
import { LISTING_CONDITIONS } from "@/server/listings/validation";
import { conditionLabel } from "@/components/listings/ConditionBadge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { buttonVariants } from "@/lib/ui/variants";
import type { CategoryOption } from "@/components/listings/ListingFormFields";

export type FilterFormValues = {
  q?: string;
  category?: string;
  condition?: string;
  minPrice?: string; // Rand display value, e.g. "250" — not cents
  maxPrice?: string;
  collection?: boolean;
  delivery?: boolean;
  sort?: SortKey;
};

/**
 * A plain GET <form> — every submission is a real, shareable,
 * bookmarkable URL (no client-side state to lose on refresh), and it
 * works without JavaScript. Server-side validation in
 * src/server/search/validation.ts is what's actually authoritative;
 * this only shapes what the URL looks like. Visually restyled for
 * Phase 11 (Input/Select/design tokens) with the exact same fields and
 * GET-form mechanics as before.
 */
export function FilterForm({
  action,
  values,
  showSearchInput = false,
  showCategorySelect = false,
  categories = [],
}: {
  action: string;
  values: FilterFormValues;
  showSearchInput?: boolean;
  showCategorySelect?: boolean;
  categories?: CategoryOption[];
}) {
  return (
    <form action={action} method="get" className="flex flex-col gap-3 rounded-card bg-brand-surface p-4 shadow-subtle">
      {showSearchInput && (
        <Input type="text" name="q" placeholder="What are you looking for?" defaultValue={values.q} aria-label="Search" />
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {showCategorySelect && (
          <Select name="category" defaultValue={values.category ?? ""} aria-label="Category" className="col-span-2 sm:col-span-1">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        )}

        <Select name="condition" defaultValue={values.condition ?? ""} aria-label="Condition">
          <option value="">Any condition</option>
          {LISTING_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {conditionLabel(c)}
            </option>
          ))}
        </Select>

        <Select name="sort" defaultValue={values.sort ?? "newest"} aria-label="Sort by">
          {Object.entries(SORT_OPTIONS).map(([key, opt]) => (
            <option key={key} value={key}>
              {opt.label}
            </option>
          ))}
        </Select>

        <Input type="text" inputMode="decimal" name="minPrice" placeholder="Min price (R)" defaultValue={values.minPrice} aria-label="Minimum price" />
        <Input type="text" inputMode="decimal" name="maxPrice" placeholder="Max price (R)" defaultValue={values.maxPrice} aria-label="Maximum price" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-body-small text-brand-ink">
          <input
            type="checkbox"
            name="collection"
            value="1"
            defaultChecked={values.collection}
            className="h-4 w-4 rounded border-brand-border text-bambini-forest focus-visible:outline-2"
          />
          Collection available
        </label>
        <label className="flex items-center gap-2 text-body-small text-brand-ink">
          <input
            type="checkbox"
            name="delivery"
            value="1"
            defaultChecked={values.delivery}
            className="h-4 w-4 rounded border-brand-border text-bambini-forest focus-visible:outline-2"
          />
          Delivery available
        </label>

        <button type="submit" className={buttonVariants({ variant: "primary", size: "sm", className: "ml-auto" })}>
          Apply
        </button>
      </div>
    </form>
  );
}
