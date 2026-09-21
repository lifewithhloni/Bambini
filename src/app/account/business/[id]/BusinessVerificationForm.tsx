"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitBusinessVerification, type SubmitBusinessVerificationState } from "@/server/business/verification/submitBusinessVerification";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Submitting…" : label}
    </button>
  );
}

export function BusinessVerificationForm({ businessId, resubmission }: { businessId: string; resubmission: boolean }) {
  const action = submitBusinessVerification.bind(null, businessId);
  const [state, formAction] = useActionState<SubmitBusinessVerificationState, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-brand-border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="documentType" className="text-sm font-medium text-brand-ink">
          What is this document?
        </label>
        <input id="documentType" name="documentType" type="text" placeholder="e.g. business registration certificate" required className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="document" className="text-sm font-medium text-brand-ink">
          Upload document
        </label>
        <input
          id="document"
          name="document"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          required
          className="text-sm text-brand-ink file:mr-3 file:rounded-full file:border-0 file:bg-brand-sage/20 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-ink"
        />
      </div>

      <p className="text-xs text-brand-muted">Kept private and only used to manually review your business. Never shown publicly.</p>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <SubmitButton label={resubmission ? "Resubmit for review" : "Submit for review"} />
    </form>
  );
}
