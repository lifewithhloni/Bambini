const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

export type CategoryOption = { id: string; label: string };

export function ListingFormFields({
  categories,
  defaultValues,
}: {
  categories: CategoryOption[];
  defaultValues?: {
    title?: string;
    categoryId?: string;
    condition?: string;
    priceRand?: string;
    description?: string;
    collectionAvailable?: boolean;
    deliveryAvailable?: boolean;
  };
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium text-brand-ink">
          Product name
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={defaultValues?.title}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="categoryId" className="text-sm font-medium text-brand-ink">
          Category
        </label>
        <select
          id="categoryId"
          name="categoryId"
          required
          defaultValue={defaultValues?.categoryId ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="condition" className="text-sm font-medium text-brand-ink">
          Condition
        </label>
        <select
          id="condition"
          name="condition"
          required
          defaultValue={defaultValues?.condition ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Choose a condition
          </option>
          <option value="like_new">Like New</option>
          <option value="excellent">Excellent</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="priceCents" className="text-sm font-medium text-brand-ink">
          Price (ZAR)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted">R</span>
          <input
            id="priceCents"
            name="priceCents"
            type="text"
            inputMode="decimal"
            required
            placeholder="0.00"
            defaultValue={defaultValues?.priceRand}
            className={`${inputClass} pl-7`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-brand-ink">
          Description <span className="text-brand-muted">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={defaultValues?.description}
          className={inputClass}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-brand-ink">Fulfilment</legend>
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            name="collectionAvailable"
            defaultChecked={defaultValues?.collectionAvailable ?? true}
            className="h-4 w-4 rounded border-brand-border text-brand-sage-dark focus:ring-brand-sage-dark"
          />
          Free collection
        </label>
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            name="deliveryAvailable"
            defaultChecked={defaultValues?.deliveryAvailable ?? true}
            className="h-4 w-4 rounded border-brand-border text-brand-sage-dark focus:ring-brand-sage-dark"
          />
          Delivery available
        </label>
      </fieldset>
    </>
  );
}
