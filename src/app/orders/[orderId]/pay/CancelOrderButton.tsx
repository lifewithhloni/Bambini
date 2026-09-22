"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { cancelPendingDeliveryOrder } from "@/server/orders/actions";

function ConfirmedCancelButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full text-center text-sm text-brand-danger hover:underline disabled:opacity-50"
    >
      {pending ? "Cancelling…" : "Cancel this order"}
    </button>
  );
}

/**
 * Phase 7B: only ever rendered for a delivery order that's still
 * pending_payment with no delivery booked yet (see the pay page's own
 * gate) — cancel_pending_delivery_order() re-validates all of that
 * server-side regardless of what this button assumes.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const action = cancelPendingDeliveryOrder.bind(null, orderId);
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <ConfirmedCancelButton />
      {state && "error" in state && (
        <p role="alert" className="text-center text-sm text-brand-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
