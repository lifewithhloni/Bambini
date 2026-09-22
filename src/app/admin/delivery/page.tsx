import Link from "next/link";
import { listStuckPendingDeliveries } from "@/server/delivery/adminStuckDeliveries";
import { formatCentsAsRand } from "@/server/listings/price";

// A live operational view — never statically cached.
export const dynamic = "force-dynamic";

/**
 * Deliberately minimal — a single read-only list, per this phase's own
 * "do not build a full delivery administration dashboard" instruction.
 * requireAdmin() (inside listStuckPendingDeliveries()) 404s this whole
 * page for anyone who isn't an admin. There is no action to take from
 * this page — no retry, no re-book, no mutation of any kind — by design:
 * the inspection that preceded this phase found no way to safely
 * distinguish "never contacted the provider" from "the provider was
 * actually contacted and Bambini crashed before recording it", so this
 * page's only job is to make a stuck booking visible for a human to
 * investigate directly with the provider, never to act on it.
 */
export default async function AdminStuckDeliveriesPage() {
  const stuck = await listStuckPendingDeliveries();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Stuck delivery bookings</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Delivery orders reserved but never booked or failed. Nothing here retries automatically — investigate
          directly with the provider before taking any action.
        </p>
        <div className="mt-2 flex gap-3">
          <Link href="/admin/delivery/transactions" className="text-sm font-medium text-brand-ink underline hover:no-underline">
            Financial transactions
          </Link>
          <Link href="/admin/delivery/settings" className="text-sm font-medium text-brand-ink underline hover:no-underline">
            Delivery pricing settings
          </Link>
        </div>
      </div>

      {stuck.length === 0 ? (
        <p className="text-sm text-brand-muted">Nothing stuck right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stuck.map((d) => (
            <li key={d.deliveryOrderId} className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-brand-ink">Order {d.orderReference}</span>
                <span className="text-brand-muted">{Math.round(d.ageMinutes)} min ago</span>
              </div>
              <div className="flex items-center justify-between text-xs text-brand-muted">
                <span>Delivery order {d.deliveryOrderId}</span>
                <span>Status: {d.status}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-brand-muted">
                <span>Provider: {d.providerName ?? "—"}</span>
                <span>{d.serviceLevel ?? "—"} {d.priceCents != null ? formatCentsAsRand(d.priceCents) : ""}</span>
              </div>
              {d.providerTrackingRef && (
                <div className="text-xs text-brand-muted">Provider tracking ref: {d.providerTrackingRef}</div>
              )}
              <div className="flex items-center justify-between text-xs text-brand-muted">
                <span>Created: {new Date(d.createdAt).toLocaleString()}</span>
                <span>Updated: {new Date(d.updatedAt).toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
