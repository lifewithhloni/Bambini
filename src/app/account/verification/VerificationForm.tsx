"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitIdentityVerification, type SubmitVerificationState } from "@/server/verification/submitIdentityVerification";

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

/**
 * Submits an ID number + document for manual admin review. Never
 * displays a stored ID number back (there isn't one to prefill — a
 * resubmission is always a fresh entry) and never claims a checksum
 * pass means "verified" — only an admin decision does that.
 */
export function VerificationForm({ resubmission }: { resubmission: boolean }) {
  const [state, formAction] = useActionState<SubmitVerificationState, FormData>(submitIdentityVerification, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-brand-border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="idNumber" className="text-sm font-medium text-brand-ink">
          South African ID number
        </label>
        <input
          id="idNumber"
          name="idNumber"
          type="text"
          inputMode="numeric"
          pattern="\d{13}"
          maxLength={13}
          placeholder="13 digits"
          required
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="document" className="text-sm font-medium text-brand-ink">
          Photo, scan, or PDF of your ID document
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

      <p className="text-xs text-brand-muted">
        Your ID number and document are kept private and are only used to manually review your identity. They are never shown to
        other users.
      </p>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <SubmitButton label={resubmission ? "Resubmit for review" : "Submit for review"} />
    </form>
  );
}
