"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { markPayoutPaid, markPayoutFailed, type PayoutActionState } from "@/server/payouts/payoutActions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full border border-brand-border px-3 py-1 text-xs font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-50">
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * mark_payout_paid()/mark_payout_failed() are the actual authorization/
 * state-machine boundary (see payoutActions.ts) — both independently
 * re-check is_admin() and the payout's current status, never trusting
 * that this form was only reachable from an admin page in the first
 * place.
 */
export function PayoutStatusActions({ payoutId }: { payoutId: string }) {
  const [showFailForm, setShowFailForm] = useState(false);

  const paidAction = markPayoutPaid.bind(null, payoutId);
  const failedAction = markPayoutFailed.bind(null, payoutId);
  const [paidState, paidFormAction] = useActionState<PayoutActionState, FormData>(paidAction, null);
  const [failedState, failedFormAction] = useActionState<PayoutActionState, FormData>(failedAction, null);

  const error = (paidState && "error" in paidState && paidState.error) || (failedState && "error" in failedState && failedState.error);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={paidFormAction} className="flex items-center gap-1">
          <input
            type="text"
            name="providerReference"
            placeholder="Reference (optional)"
            className="w-32 rounded-lg border border-brand-border bg-white px-2 py-1 text-xs"
          />
          <SubmitButton label="Mark paid" pendingLabel="Saving…" />
        </form>
        <button type="button" onClick={() => setShowFailForm((v) => !v)} className="text-xs text-brand-danger underline hover:no-underline">
          Mark failed
        </button>
      </div>
      {showFailForm && (
        <form action={failedFormAction} className="flex items-center gap-1">
          <input type="text" name="notes" placeholder="Reason (optional)" className="w-40 rounded-lg border border-brand-border bg-white px-2 py-1 text-xs" />
          <SubmitButton label="Confirm failed" pendingLabel="Saving…" />
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-danger">
          {error}
        </p>
      )}
    </div>
  );
}
