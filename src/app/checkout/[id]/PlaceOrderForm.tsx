"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
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
  cashOffered,
}: {
  productId: string;
  collectionAvailable: boolean;
  deliveryAvailable: boolean;
  /** Non-null disables the delivery option even when the listing supports it — e.g. no saved delivery location yet. */
  deliveryDisabledReason: string | null;
  /** Display only — create_order() independently re-validates cash eligibility, the global switch, and collection-only server-side regardless of this flag (see src/server/orders/getCheckoutListing.ts). */
  cashOffered: boolean;
}) {
  const action = createOrder.bind(null, productId);
  const [state, formAction] = useActionState(action, null);

  const deliverySelectable = deliveryAvailable && !deliveryDisabledReason;
  const defaultFulfilment = collectionAvailable ? "collection" : deliverySelectable ? "delivery" : "";
  const [fulfilment, setFulfilment] = useState(defaultFulfilment);

  // Cash only ever makes sense alongside collection — hiding it the
  // moment delivery is selected is a UX nicety only, not the security
  // boundary (create_order() rejects cash+delivery regardless).
  const showCashOption = cashOffered && fulfilment === "collection";

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
              checked={fulfilment === "collection"}
              onChange={() => setFulfilment("collection")}
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
              checked={fulfilment === "delivery"}
              onChange={() => setFulfilment("delivery")}
              className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
            />
            Delivery
          </label>
        )}
        {deliveryAvailable && deliveryDisabledReason && (
          <p className="text-xs text-brand-muted">{deliveryDisabledReason}</p>
        )}
      </fieldset>

      {fulfilment === "collection" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-brand-ink">Payment</legend>
          <label className="flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="radio"
              name="paymentMethod"
              value="online"
              defaultChecked
              className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
            />
            Pay online
          </label>
          {showCashOption && (
            <label className="flex items-center gap-2 text-sm text-brand-ink">
              <input type="radio" name="paymentMethod" value="cash" className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark" />
              Cash on collection
            </label>
          )}
        </fieldset>
      )}

      {state && "error" in state && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          <p>{state.error}</p>
          {state.verificationRequired && (
            <Link href="/account/verification" className="font-medium underline">
              Verify your account
            </Link>
          )}
        </div>
      )}

      <PlaceOrderButton />
    </form>
  );
}
