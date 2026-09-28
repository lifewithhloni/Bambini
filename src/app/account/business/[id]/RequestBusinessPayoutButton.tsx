"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestBusinessPayout, type PayoutActionState } from "@/server/payouts/payoutActions";
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
 * request_business_payout() only ever takes businessId — never an
 * amount, order ids, or anything else; the server independently
 * re-verifies the caller actually owns this specific business before
 * doing anything (see payoutActions.ts). This button is only ever
 * rendered for the business owner in the first place (see the payouts
 * page's own isOwner gate) — this is defense in depth, not the real
 * authorization boundary.
 */
export function RequestBusinessPayoutButton({ businessId }: { businessId: string }) {
  const action = requestBusinessPayout.bind(null, businessId);
  const [state, formAction] = useActionState<PayoutActionState, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <SubmitButton />
      {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}
