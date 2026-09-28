"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateBusiness } from "@/server/business/actions";
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

/** Rendered for the business owner only (see the settings page) — businesses_update_owner_or_admin RLS is the real boundary; a non-owner's update would match 0 rows. */
export function BusinessProfileForm({ businessId, businessName, description }: { businessId: string; businessName: string; description: string | null }) {
  const action = updateBusiness.bind(null, businessId);
  const [state, formAction] = useActionState(action, null);

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="businessName" className="text-body-small font-medium text-brand-ink">
            Business name
          </label>
          <input id="businessName" name="businessName" type="text" required defaultValue={businessName} className={inputVariants()} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-body-small font-medium text-brand-ink">
            Description <span className="text-brand-muted">(optional)</span>
          </label>
          <textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={description ?? ""} className={inputVariants()} />
        </div>

        {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}

        <div>
          <SaveButton />
        </div>
      </form>
    </Card>
  );
}
