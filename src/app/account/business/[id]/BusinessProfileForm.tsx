"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateBusiness } from "@/server/business/actions";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function BusinessProfileForm({ businessId, businessName, description }: { businessId: string; businessName: string; description: string | null }) {
  const action = updateBusiness.bind(null, businessId);
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-brand-border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="businessName" className="text-sm font-medium text-brand-ink">
          Business name
        </label>
        <input id="businessName" name="businessName" type="text" required defaultValue={businessName} className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-brand-ink">
          Description <span className="text-brand-muted">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={description ?? ""} className={inputClass} />
      </div>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
