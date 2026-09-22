"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { resolveDispute, closeDispute, type DisputeActionState } from "@/server/disputes/disputeActions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50">
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * resolve_dispute()/close_dispute() are the real authorization/
 * validation boundary (see disputeActions.ts) — independently re-check
 * is_admin(), the outcome is one of the three real resolutions, and the
 * dispute's current status. This form never moves money — it only
 * records a decision (see resolve_dispute()'s own migration comment for
 * why a resolved_buyer outcome doesn't trigger any payment/refund here).
 */
export function ResolveDisputeActions({ disputeId, status }: { disputeId: string; status: string }) {
  const resolveAction = resolveDispute.bind(null, disputeId);
  const closeAction = closeDispute.bind(null, disputeId);
  const [resolveState, resolveFormAction] = useActionState<DisputeActionState, FormData>(resolveAction, null);
  const [closeState, closeFormAction] = useActionState<DisputeActionState, FormData>(closeAction, null);
  const [outcome, setOutcome] = useState("");

  if (status === "resolved_buyer" || status === "resolved_seller" || status === "resolved_partial") {
    return (
      <form action={closeFormAction} className="flex flex-col gap-2">
        <SubmitButton label="Close dispute" pendingLabel="Closing…" />
        {closeState && "error" in closeState && (
          <p role="alert" className="text-xs text-brand-danger">
            {closeState.error}
          </p>
        )}
      </form>
    );
  }

  if (status === "closed") {
    return <p className="text-sm text-brand-muted">This dispute is closed.</p>;
  }

  return (
    <form action={resolveFormAction} className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
      <p className="text-sm font-medium text-brand-ink">Resolve this dispute</p>
      <label className="flex flex-col gap-1 text-xs text-brand-muted">
        Outcome
        <select name="outcome" required value={outcome} onChange={(e) => setOutcome(e.target.value)} className="rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink">
          <option value="" disabled>
            Choose an outcome
          </option>
          <option value="resolved_buyer">Buyer — in the buyer&apos;s favour</option>
          <option value="resolved_seller">Seller — in the seller&apos;s favour</option>
          <option value="resolved_partial">No action — dismissed</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-brand-muted">
        Resolution notes (required)
        <textarea name="notes" required rows={3} className="rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink" placeholder="Explain the decision" />
      </label>
      {outcome === "resolved_buyer" && (
        <p className="rounded-lg bg-brand-border px-3 py-2 text-xs text-brand-ink">
          This records the decision only — it does not send a refund. No refund provider is integrated yet; any actual money
          movement is a separate, future step.
        </p>
      )}
      <div>
        <SubmitButton label="Resolve" pendingLabel="Resolving…" />
      </div>
      {resolveState && "error" in resolveState && (
        <p role="alert" className="text-xs text-brand-danger">
          {resolveState.error}
        </p>
      )}
    </form>
  );
}
