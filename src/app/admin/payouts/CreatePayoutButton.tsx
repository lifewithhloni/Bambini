"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createPayout, type PayoutActionState } from "@/server/payouts/payoutActions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand-sage-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create payout"}
    </button>
  );
}

/**
 * orderIds are the exact set this specific seller group's own eligible
 * orders resolved to server-side (see listPayoutEligibleOrders()) — the
 * button only ever submits ids the admin page itself already computed
 * and rendered, never anything typed or editable client-side.
 * create_seller_payout() re-validates every one of them regardless.
 */
export function CreatePayoutButton({ orderIds }: { orderIds: string[] }) {
  const action = createPayout.bind(null, orderIds);
  const [state, formAction] = useActionState<PayoutActionState, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <SubmitButton />
      {state && "error" in state && (
        <p role="alert" className="max-w-xs text-right text-xs text-brand-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && <p className="text-xs text-brand-ink">Payout created.</p>}
    </form>
  );
}
