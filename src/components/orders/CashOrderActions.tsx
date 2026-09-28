"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptCashOrder, declineCashOrder, type CashActionState } from "@/server/orders/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

function ActionButton({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant: "primary" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} fullWidth loading={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Shown on the seller order page for a cash order still awaiting the seller's own accept/decline decision — see accept_cash_order()/decline_cash_order(). */
export function CashOrderActions({ orderId }: { orderId: string }) {
  const [acceptState, acceptAction] = useActionState<CashActionState, FormData>(
    (prev) => acceptCashOrder(orderId, prev),
    null,
  );
  const [declineState, declineAction] = useActionState<CashActionState, FormData>(
    (prev) => declineCashOrder(orderId, prev),
    null,
  );

  const error = (acceptState && "error" in acceptState && acceptState.error) || (declineState && "error" in declineState && declineState.error);

  return (
    <Card elevation="subtle">
      <div className="flex flex-col gap-3">
        <p className="text-body-small text-brand-ink">This buyer wants to pay cash on collection. Accept or decline the sale.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2">
          <form action={declineAction} className="flex-1">
            <ActionButton label="Decline" pendingLabel="Declining…" variant="outline" />
          </form>
          <form action={acceptAction} className="flex-1">
            <ActionButton label="Accept" pendingLabel="Accepting…" variant="primary" />
          </form>
        </div>
      </div>
    </Card>
  );
}
