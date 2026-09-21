const STYLES: Record<string, string> = {
  pending_payment: "bg-brand-border text-brand-ink",
  confirmed: "bg-brand-sage/30 text-brand-ink",
  ready_for_collection: "bg-brand-sage/30 text-brand-ink",
  awaiting_delivery: "bg-brand-sage/30 text-brand-ink",
  in_transit: "bg-brand-sage/30 text-brand-ink",
  completed: "bg-brand-sage-dark/20 text-brand-sage-dark",
  cancelled: "bg-brand-muted/20 text-brand-muted",
  disputed: "bg-brand-danger/10 text-brand-danger",
  refunded: "bg-brand-muted/20 text-brand-muted",
};

const LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  ready_for_collection: "Ready for collection",
  awaiting_delivery: "Awaiting delivery",
  in_transit: "In transit",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Disputed",
  refunded: "Refunded",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-brand-border text-brand-ink"}`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}

const PAYMENT_STYLES: Record<string, string> = {
  pending: "bg-brand-border text-brand-ink",
  authorized: "bg-brand-sage/30 text-brand-ink",
  paid: "bg-brand-sage-dark/20 text-brand-sage-dark",
  failed: "bg-brand-danger/10 text-brand-danger",
  refunded: "bg-brand-muted/20 text-brand-muted",
  partially_refunded: "bg-brand-muted/20 text-brand-muted",
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: "Payment pending",
  authorized: "Payment authorized",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PAYMENT_STYLES[status] ?? "bg-brand-border text-brand-ink"}`}
    >
      {PAYMENT_LABELS[status] ?? status}
    </span>
  );
}
