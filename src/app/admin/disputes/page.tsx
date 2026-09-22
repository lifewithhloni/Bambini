import Link from "next/link";
import { listDisputes } from "@/server/disputes/adminDisputes";
import { DisputeStatusBadge, DISPUTE_REASON_LABELS } from "@/components/disputes/DisputeStatusBadge";

// Live admin queue — never statically cached.
export const dynamic = "force-dynamic";

const STATUSES = ["open", "under_review", "resolved_buyer", "resolved_seller", "resolved_partial", "closed"] as const;
type DisputeStatusFilter = (typeof STATUSES)[number];

/**
 * Plain GET query-param filter, no client JS — the same pattern every
 * other server-rendered admin list in this codebase already uses (see
 * /admin/delivery/transactions). listDisputes() (requireAdmin() inside)
 * 404s this whole page for anyone who isn't an admin.
 */
export default async function AdminDisputesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const statusFilter = (STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as DisputeStatusFilter) : undefined;
  const disputes = await listDisputes(statusFilter);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Disputes</h1>
        <p className="mt-1 text-sm text-brand-muted">Buyer-raised disputes against a specific order — never a fake refund; a resolution only records the decision.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-border bg-white p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-muted">Status</span>
          <select name="status" defaultValue={statusFilter ?? ""} className="rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-full bg-brand-sage-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-sage">
          Filter
        </button>
        <Link href="/admin/disputes" className="text-sm text-brand-muted underline hover:no-underline">
          Clear
        </Link>
      </form>

      {disputes.length === 0 ? (
        <p className="text-sm text-brand-muted">No disputes match this filter.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {disputes.map((d) => (
            <li key={d.id}>
              <Link href={`/admin/disputes/${d.id}`} className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm hover:bg-brand-bg">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-brand-ink">{d.orderReference}</span>
                  <DisputeStatusBadge status={d.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-brand-muted">
                  <span>{DISPUTE_REASON_LABELS[d.reason] ?? d.reason}</span>
                  <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-brand-muted">
                  <span>Buyer: {d.buyerName ?? "—"}</span>
                  <span>Seller: {d.sellerName ?? "—"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
