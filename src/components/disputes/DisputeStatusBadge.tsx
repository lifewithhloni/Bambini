const STYLES: Record<string, string> = {
  open: "bg-brand-danger/10 text-brand-danger",
  under_review: "bg-brand-border text-brand-ink",
  resolved_buyer: "bg-brand-sage-dark/20 text-brand-sage-dark",
  resolved_seller: "bg-brand-sage-dark/20 text-brand-sage-dark",
  resolved_partial: "bg-brand-sage-dark/20 text-brand-sage-dark",
  closed: "bg-brand-muted/20 text-brand-muted",
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
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-brand-border text-brand-ink"}`}>
      {LABELS[status] ?? status}
    </span>
  );
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
