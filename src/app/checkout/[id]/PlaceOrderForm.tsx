"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createOrder } from "@/server/orders/actions";

function PlaceOrderButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-3 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Placing order…" : "Place order"}
    </button>
  );
}

export function PlaceOrderForm({
  productId,
  collectionAvailable,
  deliveryAvailable,
  deliveryDisabledReason,
}: {
  productId: string;
  collectionAvailable: boolean;
  deliveryAvailable: boolean;
  /** Non-null disables the delivery option even when the listing supports it — e.g. no saved delivery location yet. */
  deliveryDisabledReason: string | null;
}) {
  const action = createOrder.bind(null, productId);
  const [state, formAction] = useActionState(action, null);

  const deliverySelectable = deliveryAvailable && !deliveryDisabledReason;
  const defaultFulfilment = collectionAvailable ? "collection" : deliverySelectable ? "delivery" : "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-brand-ink">Fulfilment</legend>
        {collectionAvailable && (
          <label className="flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="radio"
              name="fulfilmentType"
              value="collection"
              defaultChecked={defaultFulfilment === "collection"}
              className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
            />
            Free collection
          </label>
        )}
        {deliveryAvailable && (
          <label className={`flex items-center gap-2 text-sm ${deliverySelectable ? "text-brand-ink" : "text-brand-muted"}`}>
            <input
              type="radio"
              name="fulfilmentType"
              value="delivery"
              disabled={!deliverySelectable}
              defaultChecked={defaultFulfilment === "delivery"}
              className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
            />
            Delivery
          </label>
        )}
        {deliveryAvailable && deliveryDisabledReason && (
          <p className="text-xs text-brand-muted">{deliveryDisabledReason}</p>
        )}
      </fieldset>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}

      <PlaceOrderButton />
    </form>
  );
}
