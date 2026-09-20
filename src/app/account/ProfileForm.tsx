"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateProfile } from "./actions";

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

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string | null }) {
  const [state, formAction] = useActionState(updateProfile, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="fullName" className="text-sm font-medium text-brand-ink">
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          defaultValue={fullName}
          required
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="phone" className="text-sm font-medium text-brand-ink">
          Phone <span className="text-brand-muted">(optional)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={phone ?? ""}
          className={inputClass}
        />
      </div>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && (
        <p role="status" className="rounded-lg bg-brand-sage/20 px-3 py-2 text-sm text-brand-ink">
          Profile updated.
        </p>
      )}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
