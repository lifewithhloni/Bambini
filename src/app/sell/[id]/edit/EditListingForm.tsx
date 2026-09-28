"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateListing } from "@/server/listings/actions";
import { ListingFormFields, type CategoryOption } from "@/components/listings/ListingFormFields";
import { centsToRandInput } from "@/server/listings/price";
import type { EditableListing } from "@/server/listings/getListingForEdit";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
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

      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
