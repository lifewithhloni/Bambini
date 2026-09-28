"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestPayout, type PayoutActionState } from "@/server/payouts/payoutActions";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" loading={pending}>
      {pending ? "Requesting…" : "Request payout"}
    </Button>
  );
}

/**
 * request_seller_payout() takes no arguments at all — this form never
 * submits an amount, an order id, or anything else; the server derives
 * every bit of it from the signed-in session. `success` here means "the
 * request was created," not "money has arrived" — the surrounding page
 * (SellerPayoutsPage) re-fetches and re-renders the payout list/balance
 * itself via revalidatePath(), so this component doesn't need to know
 * the new payout's shape.
 */
export function RequestPayoutButton() {
  const [state, formAction] = useActionState<PayoutActionState, FormData>(requestPayout, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <SubmitButton />
      {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}
