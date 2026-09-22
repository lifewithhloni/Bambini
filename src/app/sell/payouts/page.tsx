import { requireUser } from "@/server/auth/requireUser";
import { getMyPayouts } from "@/server/payouts/getMyPayouts";
import { getMyAvailableBalance } from "@/server/payouts/getMyAvailableBalance";
import { formatCentsAsRand } from "@/server/listings/price";
import { RequestPayoutButton } from "./RequestPayoutButton";

// A live, per-user financial view — never statically cached.
export const dynamic = "force-dynamic";

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
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Payouts</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Your earnings from completed orders, settled outside Bambini once marked paid. Payout speed depends on the
          settlement method Bambini uses — this is not an instant transfer.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-brand-border bg-white p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-muted">Available to withdraw</p>
          <p className="text-2xl font-semibold text-brand-ink">{formatCentsAsRand(availableCents)}</p>
        </div>
        {availableCents > 0 ? (
          <RequestPayoutButton />
        ) : (
          <p className="text-xs text-brand-muted">Nothing available yet — this updates as your orders are completed.</p>
        )}
      </div>

      {payouts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border px-4 py-10 text-center">
          <p className="text-brand-ink">No payouts yet.</p>
          <p className="mt-1 text-sm text-brand-muted">Payouts are created once your completed orders are settled.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {payouts.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-brand-ink">{formatCentsAsRand(p.amountCents)}</span>
                <span className="text-xs capitalize text-brand-muted">{p.status}</span>
              </div>
              <p className="text-xs text-brand-muted">
                {p.orderCount} order{p.orderCount === 1 ? "" : "s"} · Requested {new Date(p.createdAt).toLocaleDateString()}
                {p.paidAt ? ` · Paid ${new Date(p.paidAt).toLocaleDateString()}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
