import Link from "next/link";
import { notFound } from "next/navigation";
import { getDisputeDetail } from "@/server/disputes/adminDisputes";
import { formatCentsAsRand } from "@/server/listings/price";
import { DisputeStatusBadge, DISPUTE_REASON_LABELS } from "@/components/disputes/DisputeStatusBadge";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { ResolveDisputeActions } from "./ResolveDisputeActions";

export const dynamic = "force-dynamic";

export default async function AdminDisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dispute = await getDisputeDetail(id);
  if (!dispute) notFound();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 sm:py-12">
      <Link href="/admin/disputes" className="text-sm text-brand-muted hover:underline">
        ← Disputes
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-ink">{dispute.orderReference}</h1>
        <DisputeStatusBadge status={dispute.status} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Order status</span>
          <OrderStatusBadge status={dispute.orderStatus} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Buyer</span>
          <span className="text-brand-ink">{dispute.buyerName ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Seller</span>
          <span className="text-brand-ink">{dispute.sellerName ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Order total</span>
          <span className="text-brand-ink">{formatCentsAsRand(dispute.totalCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Opened</span>
          <span className="text-brand-ink">{new Date(dispute.createdAt).toLocaleString()}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-4 text-sm">
        <p className="text-xs font-medium text-brand-muted">Reason</p>
        <p className="text-brand-ink">{DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason}</p>
        {dispute.description && (
          <>
            <p className="mt-2 text-xs font-medium text-brand-muted">Buyer description</p>
            <p className="text-brand-ink">{dispute.description}</p>
          </>
        )}
      </div>

      {dispute.sellerResponse && (
        <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-4 text-sm">
          <p className="text-xs font-medium text-brand-muted">Seller response</p>
          <p className="text-brand-ink">{dispute.sellerResponse}</p>
          {dispute.sellerRespondedAt && <p className="text-xs text-brand-muted">{new Date(dispute.sellerRespondedAt).toLocaleString()}</p>}
        </div>
      )}

      {dispute.resolutionNotes && (
        <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-4 text-sm">
          <p className="text-xs font-medium text-brand-muted">Resolution</p>
          <p className="text-brand-ink">{dispute.resolutionNotes}</p>
          <p className="text-xs text-brand-muted">
            {dispute.resolvedByName ?? "An admin"} {dispute.resolvedAt ? `· ${new Date(dispute.resolvedAt).toLocaleString()}` : ""}
          </p>
        </div>
      )}

      <ResolveDisputeActions disputeId={dispute.id} status={dispute.status} />
    </div>
  );
}
