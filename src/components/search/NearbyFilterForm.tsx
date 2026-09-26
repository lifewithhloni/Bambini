import { NEARBY_SORT_OPTIONS, type NearbySortKey } from "@/server/search/nearbySort";
import { RADIUS_OPTIONS_KM, type RadiusKm } from "@/server/search/radius";
import { LISTING_CONDITIONS } from "@/server/listings/validation";
import { conditionLabel } from "@/components/listings/ConditionBadge";
import { Select } from "@/components/ui/Select";
import { buttonVariants } from "@/lib/ui/variants";
import type { CategoryOption } from "@/components/listings/ListingFormFields";

export type NearbyFilterFormValues = {
  radiusKm: RadiusKm;
  category?: string;
  condition?: string;
  collection?: boolean;
  delivery?: boolean;
  sort?: NearbySortKey;
};

/**
 * A plain GET <form>, same convention as FilterForm.tsx — every
 * submission is a shareable/bookmarkable URL, validated server-side (see
 * src/server/search/nearbyValidation.ts). Radius stays a real radio
 * group (accessible, keyboard-navigable, works with no JS) — the
 * chip-styled label is only the visual skin; the underlying input is
 * what a screen reader/keyboard actually interacts with. Only the five
 * values RADIUS_OPTIONS_KM lists (mirroring
 * search_nearby_products()'s own clamped allowlist) ever reach the URL.
 */
export function NearbyFilterForm({
  action,
  values,
  categories = [],
}: {
  action: string;
  values: NearbyFilterFormValues;
  categories?: CategoryOption[];
}) {
  return (
    <form action={action} method="get" className="flex flex-col gap-3 rounded-card bg-brand-surface p-4 shadow-subtle">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-label uppercase tracking-wide text-brand-muted">Distance</legend>
        {RADIUS_OPTIONS_KM.map((km) => (
          <label key={km} className="cursor-pointer">
            <input type="radio" name="radiusKm" value={km} defaultChecked={values.radiusKm === km} className="peer sr-only" />
            <span className="inline-flex items-center rounded-full border border-brand-border bg-brand-surface px-3.5 py-1.5 text-body-small font-medium text-brand-ink transition-colors duration-150 ease-bambini peer-checked:border-bambini-forest peer-checked:bg-bambini-forest peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bambini-forest">
              {km} km
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select name="category" defaultValue={values.category ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>

        <Select name="condition" defaultValue={values.condition ?? ""} aria-label="Condition">
          <option value="">Any condition</option>
          {LISTING_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {conditionLabel(c)}
            </option>
          ))}
        </Select>

        <Select name="sort" defaultValue={values.sort ?? "distance"} aria-label="Sort by">
          {Object.entries(NEARBY_SORT_OPTIONS).map(([key, opt]) => (
            <option key={key} value={key}>
              {opt.label}
            </option>
          ))}
        </Select>
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
