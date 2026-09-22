"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { respondToDispute, type DisputeActionState } from "@/server/disputes/disputeActions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50">
      {pending ? "Sending…" : label}
    </button>
  );
}

/**
 * respond_to_dispute() is the real authorization/validation boundary
 * (see disputeActions.ts) — independently re-checks the caller is the
 * order's seller or a member of the selling business. This form only
 * ever submits free text, never a status or resolution.
 */
export function RespondToDisputeForm({ disputeId, orderId, hasResponded }: { disputeId: string; orderId: string; hasResponded: boolean }) {
  const action = respondToDispute.bind(null, disputeId, orderId);
  const [state, formAction] = useActionState<DisputeActionState, FormData>(action, null);
  const error = state && "error" in state && state.error;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
      <p className="text-sm font-medium text-brand-ink">{hasResponded ? "Update your response" : "Respond to this dispute"}</p>
      <textarea
        name="response"
        required
        rows={3}
        className="rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink"
        placeholder="Share your side, including anything the buyer should know"
      />
      <div>
        <SubmitButton label={hasResponded ? "Update response" : "Send response"} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-brand-danger">
          {error}
        </p>
      )}
    </form>
  );
}
