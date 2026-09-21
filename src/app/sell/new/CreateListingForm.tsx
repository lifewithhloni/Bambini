"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createListing } from "@/server/listings/actions";
import { ListingFormFields, type CategoryOption } from "@/components/listings/ListingFormFields";
import { PhotoPicker } from "@/components/listings/PhotoPicker";
import { MAX_IMAGES_PER_LISTING } from "@/server/listings/imageValidation";
import type { MyBusiness } from "@/server/business/getMyBusinesses";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-2.5 font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Creating listing…" : "Create listing"}
    </button>
  );
}

export function CreateListingForm({ categories, businesses }: { categories: CategoryOption[]; businesses: MyBusiness[] }) {
  const [state, formAction] = useActionState(createListing, null);
  const [businessId, setBusinessId] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {businesses.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="businessId" className="text-sm font-medium text-brand-ink">
            Sell as
          </label>
          <select
            id="businessId"
            name="businessId"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark"
          >
            <option value="">Myself</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.businessName}
              </option>
            ))}
          </select>
          <input type="hidden" name="sellerType" value={businessId ? "business" : "parent"} />
        </div>
      )}

      <PhotoPicker maxFiles={MAX_IMAGES_PER_LISTING} />
      <ListingFormFields categories={categories} />

      {state?.error && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <SubmitButton />
      <p className="text-center text-xs text-brand-muted">Saved as a draft first — you publish when you&apos;re ready.</p>
    </form>
  );
}
