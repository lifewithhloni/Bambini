import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/lib/ui/variants";

const TONES: Record<string, BadgeTone> = {
  open: "danger",
  under_review: "neutral",
  resolved_buyer: "success",
  resolved_seller: "success",
  resolved_partial: "success",
  closed: "neutral",
};

const LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  resolved_buyer: "Resolved — buyer",
  resolved_seller: "Resolved — seller",
  resolved_partial: "Resolved — no action",
  closed: "Closed",
};

export function DisputeStatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{LABELS[status] ?? status}</Badge>;
}

export const DISPUTE_REASON_LABELS: Record<string, string> = {
  item_not_received: "Item not received",
  item_not_as_described: "Item not as described",
  damaged_item: "Item arrived damaged",
  wrong_item: "Wrong item received",
  delivery_problem: "Delivery problem",
  collection_problem: "Collection problem",
  other: "Other",
};

export const DISPUTE_REASON_OPTIONS = Object.entries(DISPUTE_REASON_LABELS) as [string, string][];
