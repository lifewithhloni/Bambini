"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createListing } from "@/server/listings/actions";
import { ListingFormFields, type CategoryOption } from "@/components/listings/ListingFormFields";
import { PhotoPicker } from "@/components/listings/PhotoPicker";
import { MAX_IMAGES_PER_LISTING } from "@/server/listings/imageValidation";

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

export function CreateListingForm({ categories }: { categories: CategoryOption[] }) {
  const [state, formAction] = useActionState(createListing, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
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
