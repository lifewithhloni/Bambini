"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { reviewVerification, type ReviewActionState } from "@/server/verification/reviewVerificationAction";

function SubmitButton({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant: "approve" | "reject" }) {
  const { pending } = useFormStatus();
  const classes =
    variant === "approve"
      ? "bg-brand-sage-dark text-white hover:bg-brand-sage"
      : "border border-brand-danger text-brand-danger hover:bg-brand-danger/10";
  return (
    <button type="submit" disabled={pending} className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${classes}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ReviewActions({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");

  const approveAction = async (prev: ReviewActionState, formData: FormData) => {
    const result = await reviewVerification(submissionId, "verified", prev, formData);
    if (!result) router.push("/admin/verifications");
    return result;
  };
  const rejectAction = async (prev: ReviewActionState, formData: FormData) => {
    const result = await reviewVerification(submissionId, "rejected", prev, formData);
    if (!result) router.push("/admin/verifications");
    return result;
  };

  const [approveState, approveFormAction] = useActionState<ReviewActionState, FormData>(approveAction, null);
  const [rejectState, rejectFormAction] = useActionState<ReviewActionState, FormData>(rejectAction, null);

  const error = (approveState && "error" in approveState && approveState.error) || (rejectState && "error" in rejectState && rejectState.error);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-4">
      <label htmlFor="notes" className="text-sm font-medium text-brand-ink">
        Review notes <span className="text-brand-muted">(shown to the user if rejected)</span>
      </label>
      <textarea
        id="notes"
        name="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink focus:border-brand-sage-dark focus:outline-none"
      />

      {error && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-xs text-brand-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <form action={rejectFormAction} className="flex-1">
          <input type="hidden" name="notes" value={notes} />
          <SubmitButton label="Reject" pendingLabel="Rejecting…" variant="reject" />
        </form>
        <form action={approveFormAction} className="flex-1">
          <input type="hidden" name="notes" value={notes} />
          <SubmitButton label="Approve" pendingLabel="Approving…" variant="approve" />
        </form>
      </div>
    </div>
  );
}
