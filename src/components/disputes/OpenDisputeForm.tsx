"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { openDispute, type DisputeActionState } from "@/server/disputes/disputeActions";
import { DISPUTE_REASON_OPTIONS } from "./DisputeStatusBadge";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50">
      {pending ? "Submitting…" : "Submit"}
    </button>
  );
}

/**
 * open_dispute() is the real authorization/validation boundary (see
 * disputeActions.ts) — this form only ever submits the order id (bound
 * server-side), a reason chosen from the fixed set, and free-text
 * details. Never a status, a resolution, or anything financial.
 */
export function OpenDisputeForm({ orderId }: { orderId: string }) {
  const [showForm, setShowForm] = useState(false);
  const action = openDispute.bind(null, orderId);
  const [state, formAction] = useActionState<DisputeActionState, FormData>(action, null);
  const error = state && "error" in state && state.error;

  if (!showForm) {
    return (
      <button type="button" onClick={() => setShowForm(true)} className="rounded-full border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg">
        Report a problem
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
      <p className="text-sm font-medium text-brand-ink">Report a problem with this order</p>
      <label className="flex flex-col gap-1 text-xs text-brand-muted">
        Reason
        <select name="reason" required defaultValue="" className="rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink">
          <option value="" disabled>
            Choose a reason
          </option>
          {DISPUTE_REASON_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-brand-muted">
        Details (optional)
        <textarea name="description" rows={3} className="rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink" placeholder="Tell us what happened" />
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton />
        <button type="button" onClick={() => setShowForm(false)} className="text-sm text-brand-muted hover:underline">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-brand-danger">
          {error}
        </p>
      )}
    </form>
  );
}
