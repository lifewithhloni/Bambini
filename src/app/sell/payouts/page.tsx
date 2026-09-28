import { requireUser } from "@/server/auth/requireUser";
import { getMyPayouts } from "@/server/payouts/getMyPayouts";
import { getMyAvailableBalance } from "@/server/payouts/getMyAvailableBalance";
import { formatCentsAsRand } from "@/server/listings/price";
import { RequestPayoutButton } from "./RequestPayoutButton";
import { SellerNav } from "@/components/sell/SellerNav";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Banknote } from "@/components/ui/icons";
import type { BadgeTone } from "@/lib/ui/variants";

// A live, per-user financial view — never statically cached.
export const dynamic = "force-dynamic";

const PAYOUT_STATUS_TONES: Record<string, BadgeTone> = {
  pending: "neutral",
  processing: "info",
  paid: "success",
  failed: "danger",
};

const PAYOUT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
};

/**
 * Deliberately minimal, matching /sell/orders' own shape — a seller's
 * own payout history only (RLS-scoped inside getMyPayouts()), never
 * another seller's, and never Bambini's own delivery margin or the
 * provider's delivery cost, neither of which this page (or its data
 * source) ever reads at all. The available balance is server-authoritative
 * (get_seller_available_balance()) — this page never computes or trusts
 * a client-side total; "Request payout" is order-independent, matching
 * request_seller_payout()'s own no-arguments shape.
 */
export default async function SellerPayoutsPage() {
  await requireUser("/sell/payouts");
  const [payouts, availableCents] = await Promise.all([getMyPayouts(), getMyAvailableBalance()]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <SellerNav />

      <div>
        <h1 className="text-heading-page text-brand-ink">Payouts</h1>
        <p className="mt-1 text-body-small text-brand-muted">
          Your earnings from completed orders, settled outside Bambini once marked paid. Payout speed depends on the
          settlement method Bambini uses — this is not an instant transfer.
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-caption font-medium text-brand-muted">Available to withdraw</p>
            <p className="text-heading-page text-brand-ink">{formatCentsAsRand(availableCents)}</p>
          </div>
          {availableCents > 0 && <RequestPayoutButton />}
        </div>
        {availableCents === 0 && <p className="mt-2 text-caption text-brand-muted">Nothing available yet — this updates as your orders are completed.</p>}
      </Card>

      {payouts.length === 0 ? (
        <EmptyState icon={Banknote} title="No payouts yet" description="Payouts are created once your completed orders are settled." />
      ) : (
        <div className="flex flex-col gap-2">
          {payouts.map((p) => (
            <Card key={p.id} elevation="subtle">
              <div className="flex items-center justify-between">
                <span className="text-price text-brand-ink">{formatCentsAsRand(p.amountCents)}</span>
                <Badge tone={PAYOUT_STATUS_TONES[p.status] ?? "neutral"}>{PAYOUT_STATUS_LABELS[p.status] ?? p.status}</Badge>
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
