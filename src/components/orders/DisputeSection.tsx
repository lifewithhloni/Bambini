import { DisputeStatusBadge, DISPUTE_REASON_LABELS } from "@/components/disputes/DisputeStatusBadge";
import { OpenDisputeForm } from "@/components/disputes/OpenDisputeForm";
import { RespondToDisputeForm } from "@/components/disputes/RespondToDisputeForm";
import type { OrderDispute } from "@/server/disputes/getOrderDispute";

// Mirrors open_dispute()'s own eligibility check exactly (see
// 20261008090000_disputes_and_transaction_protection.sql) — kept here
// as a UI convenience for hiding the "Report a problem" button when it
// would just fail server-side; the RPC re-validates independently
// regardless.
const DISPUTE_ELIGIBLE_ORDER_STATUSES = new Set(["confirmed", "ready_for_collection", "awaiting_delivery", "in_transit", "completed"]);

const ACTIVE_DISPUTE_STATUSES = new Set(["open", "under_review"]);
const RESOLVED_DISPUTE_STATUSES = new Set(["resolved_buyer", "resolved_seller", "resolved_partial", "closed"]);

/**
 * Shared by both /account/orders/[id] (buyer) and /sell/orders/[id]
 * (seller) — same order, same dispute (getOrderDispute.ts, RLS-scoped).
 * Deliberately never renders provider delivery cost or Bambini's
 * delivery margin — this section only ever reads the dispute record and
 * the order's own already-buyer/seller-safe fields.
 */
export function DisputeSection({
  orderId,
  orderStatus,
  dispute,
  viewerRole,
}: {
  orderId: string;
  orderStatus: string;
  dispute: OrderDispute | null;
  viewerRole: "buyer" | "seller";
}) {
  if (!dispute) {
    if (viewerRole === "buyer" && DISPUTE_ELIGIBLE_ORDER_STATUSES.has(orderStatus)) {
      return <OpenDisputeForm orderId={orderId} />;
    }
    return null;
  }

  const isActive = ACTIVE_DISPUTE_STATUSES.has(dispute.status);
  const isResolved = RESOLVED_DISPUTE_STATUSES.has(dispute.status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium text-brand-ink">{DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason}</span>
          <DisputeStatusBadge status={dispute.status} />
        </div>
        {dispute.description && <p className="text-xs text-brand-muted">{dispute.description}</p>}
        <p className="text-xs text-brand-muted">Opened {new Date(dispute.createdAt).toLocaleDateString()}</p>

        {dispute.sellerResponse && (
          <div className="mt-1 border-t border-brand-border pt-2">
            <p className="text-xs font-medium text-brand-muted">Seller response</p>
            <p className="text-sm text-brand-ink">{dispute.sellerResponse}</p>
          </div>
        )}

        {isResolved && (
          <div className="mt-1 border-t border-brand-border pt-2">
            <p className="text-xs font-medium text-brand-muted">Outcome</p>
            <p className="text-sm text-brand-ink">
              {dispute.status === "resolved_buyer" && "Resolved in the buyer's favour."}
              {dispute.status === "resolved_seller" && "Resolved in the seller's favour."}
              {dispute.status === "resolved_partial" && "Reviewed — no action needed."}
              {dispute.status === "closed" && "Closed."}
            </p>
            {dispute.resolvedAt && <p className="text-xs text-brand-muted">{new Date(dispute.resolvedAt).toLocaleDateString()}</p>}
          </div>
        )}
      </div>

      {viewerRole === "seller" && isActive && <RespondToDisputeForm disputeId={dispute.id} orderId={orderId} hasResponded={!!dispute.sellerResponse} />}
    </div>
  );
}
