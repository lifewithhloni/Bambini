"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestPayout, type PayoutActionState } from "@/server/payouts/payoutActions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Requesting…" : "Request payout"}
    </button>
  );
}

/**
 * request_seller_payout() takes no arguments at all — this form never
 * submits an amount, an order id, or anything else; the server derives
 * every bit of it from the signed-in session. `success` here means "the
 * request was created," not "money has arrived" — the surrounding page
 * (SellerPayoutsPage) re-fetches and re-renders the payout list/balance
 * itself via revalidatePath(), so this component doesn't need to know
 * the new payout's shape.
 */
export function RequestPayoutButton() {
  const [state, formAction] = useActionState<PayoutActionState, FormData>(requestPayout, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <SubmitButton />
      {state && "error" in state && (
        <p role="alert" className="text-xs text-brand-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
