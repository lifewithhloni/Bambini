"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestBusinessPayout, type PayoutActionState } from "@/server/payouts/payoutActions";

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
 * request_business_payout() only ever takes businessId — never an
 * amount, order ids, or anything else; the server independently
 * re-verifies the caller actually owns this specific business before
 * doing anything (see payoutActions.ts). This button is only ever
 * rendered for the business owner in the first place (see
 * page.tsx's own isOwner gate) — this is defense in depth, not the
 * real authorization boundary.
 */
export function RequestBusinessPayoutButton({ businessId }: { businessId: string }) {
  const action = requestBusinessPayout.bind(null, businessId);
  const [state, formAction] = useActionState<PayoutActionState, FormData>(action, null);

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
