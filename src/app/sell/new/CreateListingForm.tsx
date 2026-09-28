"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createListing } from "@/server/listings/actions";
import { ListingFormFields, type CategoryOption } from "@/components/listings/ListingFormFields";
import { PhotoPicker } from "@/components/listings/PhotoPicker";
import { MAX_IMAGES_PER_LISTING } from "@/server/listings/imageValidation";
import type { MyBusiness } from "@/server/business/getMyBusinesses";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" fullWidth loading={pending}>
      {pending ? "Creating listing…" : "Create listing"}
    </Button>
  );
}

export function CreateListingForm({ categories, businesses }: { categories: CategoryOption[]; businesses: MyBusiness[] }) {
  const [state, formAction] = useActionState(createListing, null);
  const [businessId, setBusinessId] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {businesses.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="businessId" className="text-body-small font-medium text-brand-ink">
            Sell as
          </label>
          <select id="businessId" name="businessId" value={businessId} onChange={(e) => setBusinessId(e.target.value)} className={inputVariants()}>
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

      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <SubmitButton />
      <p className="text-center text-caption text-brand-muted">Saved as a draft first — you publish when you&apos;re ready.</p>
    </form>
  );
}
