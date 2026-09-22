"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateDeliveryMarkup } from "@/server/delivery/updateDeliveryMarkupAction";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand-sage-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/**
 * update_delivery_markup_setting() is the actual validation/authorization
 * boundary (see updateDeliveryMarkupAction.ts) — this form's own
 * min/max/step are a UX nicety, not the security boundary.
 */
export function MarkupSettingsForm({ currentPercentage }: { currentPercentage: number }) {
  const [state, formAction] = useActionState(updateDeliveryMarkup, null);
  const [value, setValue] = useState(String(currentPercentage));

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-brand-border bg-white p-4">
      <label htmlFor="markupPercentage" className="text-sm font-medium text-brand-ink">
        Delivery markup percentage
      </label>
      <div className="flex items-center gap-2">
        <input
          id="markupPercentage"
          name="markupPercentage"
          type="number"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 rounded-lg border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink focus:border-brand-sage-dark focus:outline-none"
        />
        <span className="text-sm text-brand-muted">%</span>
        <SaveButton />
      </div>
      <p className="text-xs text-brand-muted">
        Applied on top of the provider&apos;s own delivery cost for every new quote. Existing orders keep the rate that
        was in effect when their quote was fetched — changing this never affects an order already placed.
      </p>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && (
        <p role="status" className="rounded-lg bg-brand-sage/10 px-3 py-2 text-sm text-brand-ink">
          Saved.
        </p>
      )}
    </form>
  );
}
