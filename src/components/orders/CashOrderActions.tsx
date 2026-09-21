"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptCashOrder, declineCashOrder, type CashActionState } from "@/server/orders/actions";

function ActionButton({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const classes =
    variant === "primary"
      ? "bg-brand-sage-dark text-white hover:bg-brand-sage"
      : "border border-brand-border bg-white text-brand-ink hover:bg-brand-bg";
  return (
    <button type="submit" disabled={pending} className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${classes}`}>
      {pending ? pendingLabel : label}
    </button>
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
    <div className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
      <p className="text-sm text-brand-ink">This buyer wants to pay cash on collection. Accept or decline the sale.</p>
      {error && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-xs text-brand-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <form action={declineAction} className="flex-1">
          <ActionButton label="Decline" pendingLabel="Declining…" variant="secondary" />
        </form>
        <form action={acceptAction} className="flex-1">
          <ActionButton label="Accept" pendingLabel="Accepting…" variant="primary" />
        </form>
      </div>
    </div>
  );
}
