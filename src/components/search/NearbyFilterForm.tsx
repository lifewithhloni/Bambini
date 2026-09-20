import { NEARBY_SORT_OPTIONS, type NearbySortKey } from "@/server/search/nearbySort";
import { RADIUS_OPTIONS_KM, type RadiusKm } from "@/server/search/radius";
import { LISTING_CONDITIONS } from "@/server/listings/validation";
import { conditionLabel } from "@/components/listings/ConditionBadge";
import type { CategoryOption } from "@/components/listings/ListingFormFields";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

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
 * src/server/search/nearbyValidation.ts). Radius is a fixed set of
 * buttons, not a free-entry field — the only five values (this component
 * plus the "no radius param at all" case) that ever reach the URL are
 * the ones search_nearby_products() itself accepts.
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
    <form action={action} method="get" className="flex flex-col gap-3 rounded-lg border border-brand-border bg-white p-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-sm font-medium text-brand-ink">Distance</legend>
        {RADIUS_OPTIONS_KM.map((km) => (
          <label key={km} className="cursor-pointer">
            <input type="radio" name="radiusKm" value={km} defaultChecked={values.radiusKm === km} className="peer sr-only" />
            <span className="rounded-full border border-brand-border px-4 py-2 text-sm text-brand-ink peer-checked:border-brand-sage-dark peer-checked:bg-brand-sage/20 peer-checked:font-medium">
              {km} km
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select name="category" defaultValue={values.category ?? ""} className={inputClass}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <select name="condition" defaultValue={values.condition ?? ""} className={inputClass}>
          <option value="">Any condition</option>
          {LISTING_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {conditionLabel(c)}
            </option>
          ))}
        </select>

        <select name="sort" defaultValue={values.sort ?? "distance"} className={inputClass}>
          {Object.entries(NEARBY_SORT_OPTIONS).map(([key, opt]) => (
            <option key={key} value={key}>
              {opt.label}
            </option>
          ))}
        </select>
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
