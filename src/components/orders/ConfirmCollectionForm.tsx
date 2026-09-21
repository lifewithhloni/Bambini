"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { confirmCollection, type ConfirmCollectionState } from "@/server/orders/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Confirming…" : "Confirm collection"}
    </button>
  );
}

/**
 * Seller enters the 6-digit code the buyer shows them in person —
 * confirm_collection() validates it server-side; this form never has
 * access to the true stored code (see get_my_collection_code(), which is
 * buyer-only) so there's nothing here to leak or pre-fill.
 */
export function ConfirmCollectionForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<ConfirmCollectionState, FormData>((prev, formData) => confirmCollection(orderId, prev, formData), null);

  if (state && "success" in state) {
    return (
      <div className="rounded-lg border border-brand-border bg-white p-3">
        <p className="text-sm font-medium text-brand-ink">Collection confirmed. This order is now complete.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
      <label htmlFor="collection-code" className="text-sm font-medium text-brand-ink">
        Enter the buyer&apos;s collection code
      </label>
      <input
        id="collection-code"
        name="code"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        placeholder="123456"
        required
        className="rounded-lg border border-brand-border px-3 py-2 text-sm tracking-widest text-brand-ink focus:border-brand-sage-dark focus:outline-none"
      />
      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-xs text-brand-danger">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
