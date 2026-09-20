"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateListing } from "@/server/listings/actions";
import { ListingFormFields, type CategoryOption } from "@/components/listings/ListingFormFields";
import { centsToRandInput } from "@/server/listings/price";
import type { EditableListing } from "@/server/listings/getListingForEdit";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function EditListingForm({ listing, categories }: { listing: EditableListing; categories: CategoryOption[] }) {
  const boundAction = updateListing.bind(null, listing.id);
  const [state, formAction] = useActionState(boundAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ListingFormFields
        categories={categories}
        defaultValues={{
          title: listing.title,
          categoryId: listing.category_id,
          condition: listing.condition,
          priceRand: centsToRandInput(listing.price_cents),
          description: listing.description ?? "",
          collectionAvailable: listing.collection_available,
          deliveryAvailable: listing.delivery_available,
        }}
      />

      {state?.error && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
