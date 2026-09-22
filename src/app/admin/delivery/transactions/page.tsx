import Link from "next/link";
import { listDeliveryFinancialTransactions } from "@/server/delivery/adminFinancialTransactions";
import { formatCentsAsRand } from "@/server/listings/price";

// Live financial data — never statically cached.
export const dynamic = "force-dynamic";

const DELIVERY_STATUSES = ["pending", "booked", "collected_by_courier", "in_transit", "delivered", "failed", "cancelled"];
const PAYMENT_STATUSES = ["pending", "authorized", "paid", "failed", "refunded", "partially_refunded"];

/**
 * Deliberately a clean table, not an analytics dashboard — per this
 * phase's own "no charts, no advanced accounting" instruction. Filters
 * are plain GET query params (no client JS needed) so the page works
 * the same way every other server-rendered admin list in this codebase
 * does. listDeliveryFinancialTransactions() (list_delivery_financial_transactions()
 * underneath) is the only place in the app that can read
 * provider_delivery_cost_cents/delivery_markup_*_bps/delivery_margin —
 * see that function's own migration comment for why a plain admin
 * session can't read these columns any other way.
 */
export default async function AdminDeliveryTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    fulfilmentType?: string;
    deliveryStatus?: string;
    paymentStatus?: string;
    providerSlug?: string;
    createdAfter?: string;
    createdBefore?: string;
  }>;
}) {
  const params = await searchParams;
  const transactions = await listDeliveryFinancialTransactions({
    fulfilmentType: params.fulfilmentType === "collection" || params.fulfilmentType === "delivery" ? params.fulfilmentType : undefined,
    deliveryStatus: params.deliveryStatus || undefined,
    paymentStatus: params.paymentStatus || undefined,
    providerSlug: params.providerSlug || undefined,
    createdAfter: params.createdAfter || undefined,
    createdBefore: params.createdBefore || undefined,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Delivery financial transactions</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Provider cost, markup, and Bambini&apos;s delivery margin per order — distinct from marketplace commission,
          shown on each order&apos;s own admin record elsewhere. Never shown to buyers or sellers.
        </p>
        <div className="mt-2 flex gap-3">
          <Link href="/admin/delivery" className="text-sm font-medium text-brand-ink underline hover:no-underline">
            Stuck bookings
          </Link>
          <Link href="/admin/delivery/settings" className="text-sm font-medium text-brand-ink underline hover:no-underline">
            Markup settings
          </Link>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-border bg-white p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">Method</span>
          <select name="fulfilmentType" defaultValue={params.fulfilmentType ?? ""} className="rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All</option>
            <option value="collection">Collection</option>
            <option value="delivery">Delivery</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">Delivery status</span>
          <select name="deliveryStatus" defaultValue={params.deliveryStatus ?? ""} className="rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">Payment status</span>
          <select name="paymentStatus" defaultValue={params.paymentStatus ?? ""} className="rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">Provider</span>
          <input name="providerSlug" defaultValue={params.providerSlug ?? ""} placeholder="mock" className="w-24 rounded-lg border border-brand-border bg-white px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">From</span>
          <input type="date" name="createdAfter" defaultValue={params.createdAfter ?? ""} className="rounded-lg border border-brand-border bg-white px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">To</span>
          <input type="date" name="createdBefore" defaultValue={params.createdBefore ?? ""} className="rounded-lg border border-brand-border bg-white px-2 py-1.5" />
        </label>
        <button type="submit" className="rounded-full bg-brand-sage-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-sage">
          Filter
        </button>
        <Link href="/admin/delivery/transactions" className="text-sm text-brand-muted underline hover:no-underline">
          Clear
        </Link>
      </form>

      {transactions.length === 0 ? (
        <p className="text-sm text-brand-muted">No transactions match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-brand-border text-xs text-brand-muted">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Provider cost</th>
                <th className="px-3 py-2">Buyer fee</th>
                <th className="px-3 py-2">Markup %</th>
                <th className="px-3 py-2">Markup amount</th>
                <th className="px-3 py-2">Margin</th>
                <th className="px-3 py-2">Delivery status</th>
                <th className="px-3 py-2">Payment status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.orderId} className="border-b border-brand-border last:border-0">
                  <td className="px-3 py-2 font-medium text-brand-ink">{t.orderReference}</td>
                  <td className="px-3 py-2 text-brand-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 capitalize">{t.fulfilmentType}</td>
                  <td className="px-3 py-2">{t.providerSlug ?? "—"}</td>
                  <td className="px-3 py-2">{formatCentsAsRand(t.providerDeliveryCostCents)}</td>
                  <td className="px-3 py-2">{formatCentsAsRand(t.buyerDeliveryFeeCents)}</td>
                  <td className="px-3 py-2">{(t.deliveryMarkupPercentageBps / 100).toFixed(1)}%</td>
                  <td className="px-3 py-2">{formatCentsAsRand(t.deliveryMarkupAmountCents)}</td>
                  <td className="px-3 py-2 font-medium">{formatCentsAsRand(t.deliveryMarginCents)}</td>
                  <td className="px-3 py-2">{t.deliveryStatus ?? "—"}</td>
                  <td className="px-3 py-2">{t.paymentStatus ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
