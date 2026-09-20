import { SORT_OPTIONS, type SortKey } from "@/server/search/sort";
import { LISTING_CONDITIONS } from "@/server/listings/validation";
import { conditionLabel } from "@/components/listings/ConditionBadge";
import type { CategoryOption } from "@/components/listings/ListingFormFields";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

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
 * this only shapes what the URL looks like.
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
    <form action={action} method="get" className="flex flex-col gap-3 rounded-lg border border-brand-border bg-white p-3">
      {showSearchInput && (
        <input
          type="text"
          name="q"
          placeholder="What are you looking for?"
          defaultValue={values.q}
          className={inputClass}
          aria-label="Search"
        />
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {showCategorySelect && (
          <select name="category" defaultValue={values.category ?? ""} className={`${inputClass} col-span-2 sm:col-span-1`}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}

        <select name="condition" defaultValue={values.condition ?? ""} className={inputClass}>
          <option value="">Any condition</option>
          {LISTING_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {conditionLabel(c)}
            </option>
          ))}
        </select>

        <select name="sort" defaultValue={values.sort ?? "newest"} className={inputClass}>
          {Object.entries(SORT_OPTIONS).map(([key, opt]) => (
            <option key={key} value={key}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          inputMode="decimal"
          name="minPrice"
          placeholder="Min price (R)"
          defaultValue={values.minPrice}
          className={inputClass}
        />
        <input
          type="text"
          inputMode="decimal"
          name="maxPrice"
          placeholder="Max price (R)"
          defaultValue={values.maxPrice}
          className={inputClass}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            name="collection"
            value="1"
            defaultChecked={values.collection}
            className="h-4 w-4 rounded border-brand-border text-brand-sage-dark focus:ring-brand-sage-dark"
          />
          Collection available
        </label>
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            name="delivery"
            value="1"
            defaultChecked={values.delivery}
            className="h-4 w-4 rounded border-brand-border text-brand-sage-dark focus:ring-brand-sage-dark"
          />
          Delivery available
        </label>

        <button
          type="submit"
          className="ml-auto rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage"
        >
          Apply
        </button>
      </div>
    </form>
  );
}
