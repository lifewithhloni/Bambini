import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/lib/ui/variants";

const TONES: Record<string, BadgeTone> = {
  pending_payment: "neutral",
  confirmed: "info",
  ready_for_collection: "info",
  awaiting_delivery: "info",
  in_transit: "info",
  completed: "success",
  cancelled: "neutral",
  disputed: "danger",
  refunded: "neutral",
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
  return <Badge tone={TONES[status] ?? "neutral"}>{LABELS[status] ?? status}</Badge>;
}

const PAYMENT_TONES: Record<string, BadgeTone> = {
  pending: "neutral",
  authorized: "info",
  paid: "success",
  failed: "danger",
  refunded: "neutral",
  partially_refunded: "neutral",
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
  return <Badge tone={PAYMENT_TONES[status] ?? "neutral"}>{PAYMENT_LABELS[status] ?? status}</Badge>;
}
