"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recoverPayout, type PayoutActionState } from "@/server/payouts/payoutActions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full border border-brand-border px-3 py-1 text-xs font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-50">
      {pending ? "Recovering…" : "Confirm recovery"}
    </button>
  );
}

/**
 * recover_failed_payout() is the actual authorization/state-machine
 * boundary (see payoutActions.ts) — independently re-checks is_admin(),
 * status = 'failed', and a non-empty reason. This form never creates a
 * new payout itself; it only supersedes the old claims so their orders
 * reappear under "Eligible for payout", where a separate, explicit
 * CreatePayoutButton click is required — recovery is never a
 * self-triggering chain.
 */
export function RecoverPayoutAction({ payoutId }: { payoutId: string }) {
  const [showForm, setShowForm] = useState(false);
  const action = recoverPayout.bind(null, payoutId);
  const [state, formAction] = useActionState<PayoutActionState, FormData>(action, null);
  const error = state && "error" in state && state.error;
  const succeeded = state && "success" in state && state.success;

  if (succeeded) {
    return <p className="text-xs text-brand-muted">Recovered.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setShowForm((v) => !v)} className="text-xs text-brand-ink underline hover:no-underline">
        Recover payout
      </button>
      {showForm && (
        <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-brand-border bg-brand-bg p-2">
          <p className="text-xs text-brand-muted">
            This does not automatically send money. It releases the associated orders for a new payout after explicit admin
            confirmation.
          </p>
          <textarea
            name="reason"
            required
            placeholder="Bank transfer failed — confirmed funds were not sent."
            className="w-full rounded-lg border border-brand-border bg-white px-2 py-1 text-xs"
            rows={2}
          />
          <div>
            <SubmitButton />
          </div>
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
