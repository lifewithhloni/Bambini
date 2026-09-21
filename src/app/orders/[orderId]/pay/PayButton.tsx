"use client";

import { useState, useTransition } from "react";
import { initiatePayment } from "@/server/payments/actions";
import type { CheckoutSession } from "@/server/payments/types";

/**
 * The server has already built and signed everything PayFast needs
 * (see initiatePayment()) — this only takes that already-authoritative
 * payload and submits it. React never constructs or touches the
 * signature/amount/merchant fields themselves, only renders whatever
 * the server returned.
 */
function submitToProvider(session: CheckoutSession) {
  if (!session.formFields) {
    window.location.href = session.redirectUrl;
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = session.redirectUrl;
  for (const [key, value] of Object.entries(session.formFields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function PayButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await initiatePayment(orderId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      submitToProvider(result.session);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded-full bg-brand-sage-dark px-4 py-3 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
      >
        {isPending ? "Preparing secure payment…" : "Pay with PayFast"}
      </button>
      {error && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {error}
        </p>
      )}
    </div>
  );
}
