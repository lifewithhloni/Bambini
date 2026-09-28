"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateProfile } from "./actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" loading={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string | null }) {
  const [state, formAction] = useActionState(updateProfile, null);

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="fullName" className="text-body-small font-medium text-brand-ink">
            Full name
          </label>
          <input id="fullName" name="fullName" type="text" autoComplete="name" defaultValue={fullName} required className={inputVariants()} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-body-small font-medium text-brand-ink">
            Phone <span className="text-brand-muted">(optional)</span>
          </label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={phone ?? ""} className={inputVariants()} />
        </div>

        {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}
        {state && "success" in state && <Alert tone="success">Profile updated.</Alert>}

        <div>
          <SaveButton />
        </div>
      </form>
    </Card>
  );
}
