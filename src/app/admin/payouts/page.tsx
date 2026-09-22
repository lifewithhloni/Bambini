import { Fragment } from "react";
import { listPayoutEligibleOrders } from "@/server/payouts/adminPayoutEligibility";
import { listPayouts } from "@/server/payouts/adminPayouts";
import { formatCentsAsRand } from "@/server/listings/price";
import { CreatePayoutButton } from "./CreatePayoutButton";
import { PayoutStatusActions } from "./PayoutStatusActions";
import { RecoverPayoutAction } from "./RecoverPayoutAction";

// Live financial/operational data — never statically cached.
export const dynamic = "force-dynamic";

/**
 * Deliberately a single page with two sections, not a full accounting
 * system — per this phase's own "keep it simple" instruction. There is
 * no way to edit a financial AMOUNT anywhere on this page: the only
 * actions are "create a payout for exactly these already-computed
 * orders" and "mark this already-computed payout paid/failed" — both
 * re-validated entirely server-side (create_seller_payout()/
 * mark_payout_paid()/mark_payout_failed()), never a form field the
 * admin can edit into a different number.
 */
export default async function AdminPayoutsPage() {
  const [eligibleGroups, payouts] = await Promise.all([listPayoutEligibleOrders(), listPayouts()]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Seller payouts</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Internal settlement ledger — no bank transfer happens from this page. &quot;Mark paid&quot; records that a
          payout was completed outside Bambini (e.g. a manual bank transfer), it doesn&apos;t trigger one.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-brand-ink">Eligible for payout</h2>
        {eligibleGroups.length === 0 ? (
          <p className="text-sm text-brand-muted">Nothing eligible right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eligibleGroups.map((group) => (
              <li key={group.key} className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-brand-ink">{group.sellerName ?? "Unknown seller"}</span>
                  <span className="text-xs capitalize text-brand-muted">{group.sellerType}</span>
                </div>
                <div className="flex flex-col gap-1 text-xs text-brand-muted">
                  {group.orders.map((o) => (
                    <div key={o.orderId} className="flex items-center justify-between">
                      <span>{o.orderReference}</span>
                      <span>
                        {formatCentsAsRand(o.subtotalCents)} - {formatCentsAsRand(o.commissionAmountCents)} = {formatCentsAsRand(o.netEarningsCents)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-brand-border pt-2">
                  <span className="text-sm font-medium text-brand-ink">Total: {formatCentsAsRand(group.totalNetCents)}</span>
                  <CreatePayoutButton orderIds={group.orders.map((o) => o.orderId)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-brand-ink">Payouts</h2>
        {payouts.length === 0 ? (
          <p className="text-sm text-brand-muted">No payouts created yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-brand-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-brand-border text-xs text-brand-muted">
                <tr>
                  <th className="px-3 py-2">Seller</th>
                  <th className="px-3 py-2">Orders</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Requested</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-brand-border last:border-0 align-top">
                      <td className="px-3 py-2 font-medium text-brand-ink">
                        {p.sellerName ?? "—"}
                        <span className="ml-1.5 rounded-full bg-brand-bg px-1.5 py-0.5 text-[10px] font-normal capitalize text-brand-muted">{p.sellerType}</span>
                      </td>
                      <td className="px-3 py-2">
                        {p.orders.length === 0 ? (
                          p.orderCount
                        ) : (
                          <details>
                            <summary className="cursor-pointer">{p.orderCount}</summary>
                            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-brand-muted">
                              {p.orders.map((o) => (
                                <li key={o.orderId} className="flex items-center justify-between gap-2">
                                  <span>{o.orderReference ?? o.orderId}</span>
                                  <span>{formatCentsAsRand(o.amountCents)}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="px-3 py-2">{formatCentsAsRand(p.amountCents)}</td>
                      <td className="px-3 py-2 capitalize">{p.status}</td>
                      <td className="px-3 py-2 text-xs text-brand-muted">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-xs text-brand-muted">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2 text-xs text-brand-muted">{p.providerReference ?? "—"}</td>
                      <td className="px-3 py-2">
                        {(p.status === "pending" || p.status === "processing") && <PayoutStatusActions payoutId={p.id} />}
                        {p.status === "failed" && <RecoverPayoutAction payoutId={p.id} />}
                      </td>
                    </tr>
                    {p.status === "recovered" && (
                      <tr className="border-b border-brand-border last:border-0 bg-brand-bg">
                        <td colSpan={8} className="px-3 py-2 text-xs text-brand-muted">
                          Recovered by {p.recoveredByName ?? "an admin"} on {p.recoveredAt ? new Date(p.recoveredAt).toLocaleDateString() : "—"}
                          {p.recoveryReason ? <> — &ldquo;{p.recoveryReason}&rdquo;</> : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
