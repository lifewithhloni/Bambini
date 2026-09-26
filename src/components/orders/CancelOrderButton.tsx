"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { cancelPendingDeliveryOrder } from "@/server/orders/actions";
import { Alert } from "@/components/ui/Alert";

function ConfirmedCancelButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full text-center text-body-small text-brand-danger hover:underline disabled:opacity-50"
    >
      {pending ? "Cancelling…" : "Cancel this order"}
    </button>
  );
}

/**
 * Phase 7B: only ever rendered for a delivery order that's still
 * pending_payment with no delivery booked yet — cancel_pending_delivery_order()
 * re-validates all of that server-side regardless of what a caller assumes.
 * Shared by /orders/[orderId]/pay and /account/orders/[id] (Phase 12D) —
 * the same eligibility gate, rendered wherever the buyer might reasonably
 * look for it, not two separate cancellation implementations.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const action = cancelPendingDeliveryOrder.bind(null, orderId);
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <ConfirmedCancelButton />
      {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}
