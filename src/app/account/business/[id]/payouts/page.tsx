import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessAvailableBalance } from "@/server/payouts/getBusinessAvailableBalance";
import { getBusinessPayouts } from "@/server/payouts/getBusinessPayouts";
import { formatCentsAsRand } from "@/server/listings/price";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { RequestBusinessPayoutButton } from "../RequestBusinessPayoutButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { Banknote } from "@/components/ui/icons";
import type { BadgeTone } from "@/lib/ui/variants";

export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, BadgeTone> = { pending: "neutral", processing: "info", paid: "success", failed: "danger" };
const STATUS_LABELS: Record<string, string> = { pending: "Pending", processing: "Processing", paid: "Paid", failed: "Failed" };

/**
 * The balance is server-authoritative (get_business_available_balance(),
 * this business only — never merged with the owner's personal /sell/payouts
 * balance), and "Request payout" is OWNER ONLY: any member may read the
 * balance and history, but the button is rendered for the owner alone,
 * and request_business_payout() re-derives ownership from auth.uid()
 * regardless of this page (see payoutActions.ts / Phase 8C).
 */
export default async function BusinessPayoutsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}/payouts`);
  const [availableCents, payouts] = await Promise.all([getBusinessAvailableBalance(id), getBusinessPayouts(id)]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />

      <div>
        <h2 className="text-heading-card text-brand-ink">Payouts</h2>
        <p className="mt-1 text-body-small text-brand-muted">
          Earnings from this business&apos;s completed orders, settled outside Bambini once marked paid. Payout speed depends on the settlement method
          Bambini uses — this is not an instant transfer.
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-caption font-medium text-brand-muted">Available to withdraw</p>
            <p className="text-heading-page text-brand-ink">{formatCentsAsRand(availableCents)}</p>
          </div>
          {isOwner && availableCents > 0 && <RequestBusinessPayoutButton businessId={business.id} />}
        </div>
        {availableCents === 0 && <p className="mt-2 text-caption text-brand-muted">No earnings are currently available for withdrawal.</p>}
      </Card>

      {!isOwner && <Alert tone="info">Only the business owner can request a payout.</Alert>}

      {payouts.length === 0 ? (
        <EmptyState icon={Banknote} title="No payouts yet" description="Payouts are created once completed orders are settled." />
      ) : (
        <div className="flex flex-col gap-2">
          {payouts.map((p) => (
            <Card key={p.id} elevation="subtle">
              <div className="flex items-center justify-between">
                <span className="text-price text-brand-ink">{formatCentsAsRand(p.amountCents)}</span>
                <Badge tone={STATUS_TONES[p.status] ?? "neutral"}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
              </div>
              <p className="mt-1 text-caption text-brand-muted">
                {p.orderCount} order{p.orderCount === 1 ? "" : "s"} · Requested {new Date(p.createdAt).toLocaleDateString()}
                {p.paidAt ? ` · Paid ${new Date(p.paidAt).toLocaleDateString()}` : ""}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
