"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { confirmCollection, type ConfirmCollectionState } from "@/server/orders/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" fullWidth loading={pending}>
      {pending ? "Confirming…" : "Confirm collection"}
    </Button>
  );
}

/**
 * Seller enters the 6-digit code the buyer shows them in person —
 * confirm_collection() validates it server-side; this form never has
 * access to the true stored code (see get_my_collection_code(), which is
 * buyer-only) so there's nothing here to leak or pre-fill.
 */
export function ConfirmCollectionForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<ConfirmCollectionState, FormData>((prev, formData) => confirmCollection(orderId, prev, formData), null);

  if (state && "success" in state) {
    return (
      <Card elevation="subtle">
        <p className="text-body-small font-medium text-brand-ink">Collection confirmed. This order is now complete.</p>
      </Card>
    );
  }

  return (
    <Card elevation="subtle">
      <form action={formAction} className="flex flex-col gap-2">
        <label htmlFor="collection-code" className="text-body-small font-medium text-brand-ink">
          Enter the buyer&apos;s collection code
        </label>
        <input
          id="collection-code"
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123456"
          required
          className={inputVariants({ className: "tracking-widest" })}
        />
        {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}
        <SubmitButton />
      </form>
    </Card>
  );
}
