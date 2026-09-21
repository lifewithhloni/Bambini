"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createBusiness } from "@/server/business/actions";
import { slugify } from "@/server/business/slug";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create business"}
    </button>
  );
}

export function BusinessForm() {
  const [state, formAction] = useActionState(createBusiness, null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="businessName" className="text-sm font-medium text-brand-ink">
          Business name
        </label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="slug" className="text-sm font-medium text-brand-ink">
          Storefront URL
        </label>
        <div className="flex items-center gap-1 text-sm text-brand-muted">
          <span>bambini.co.za/business/</span>
        </div>
        <input
          id="slug"
          name="slug"
          type="text"
          required
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="registrationNumber" className="text-sm font-medium text-brand-ink">
          Registration number <span className="text-brand-muted">(optional)</span>
        </label>
        <input id="registrationNumber" name="registrationNumber" type="text" className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="vatNumber" className="text-sm font-medium text-brand-ink">
          VAT number <span className="text-brand-muted">(optional)</span>
        </label>
        <input id="vatNumber" name="vatNumber" type="text" className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-brand-ink">
          Description <span className="text-brand-muted">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={4} maxLength={2000} className={inputClass} />
      </div>

      {state?.error && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
