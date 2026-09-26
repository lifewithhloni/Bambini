"use client";

import { useState, useTransition } from "react";
import { initiatePayment } from "@/server/payments/actions";
import type { CheckoutSession } from "@/server/payments/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

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
      {/* onClick + local isPending, not a plain <form action>, because the
          server first has to hand back PayFast's own form fields/URL for
          submitToProvider() to POST the browser to — disabled here (not
          just visually, via `loading`) is this button's whole protection
          against a rapid double-click starting two requests; the actual
          duplicate-payment protection remains server-side (payments.order_id
          is unique, record_payment_attempt() only ever UPDATEs). */}
      <Button type="button" variant="primary" size="lg" fullWidth loading={isPending} onClick={handleClick}>
        {isPending ? "Preparing secure payment…" : "Pay with PayFast"}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
