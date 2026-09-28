"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitIdentityVerification, type SubmitVerificationState } from "@/server/verification/submitIdentityVerification";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" fullWidth loading={pending}>
      {pending ? "Submitting…" : label}
    </Button>
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
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="idNumber" className="text-body-small font-medium text-brand-ink">
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
            className={inputVariants()}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="document" className="text-body-small font-medium text-brand-ink">
            Photo, scan, or PDF of your ID document
          </label>
          <input
            id="document"
            name="document"
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            required
            className="text-body-small text-brand-ink file:mr-3 file:rounded-full file:border-0 file:bg-brand-light-sage file:px-3 file:py-1.5 file:text-body-small file:font-medium file:text-brand-ink"
          />
        </div>

        <p className="text-caption text-brand-muted">
          Your ID number and document are kept private and are only used to manually review your identity. They are never shown to other
          users.
        </p>

        {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}

        <SubmitButton label={resubmission ? "Resubmit for review" : "Submit for review"} />
      </form>
    </Card>
  );
}
