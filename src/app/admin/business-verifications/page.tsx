import Link from "next/link";
import { listPendingBusinessVerifications } from "@/server/business/verification/adminBusinessVerifications";

export const dynamic = "force-dynamic";

export default async function AdminBusinessVerificationsPage() {
  const pending = await listPendingBusinessVerifications();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">Pending business verifications</h1>

      {pending.length === 0 ? (
        <p className="text-sm text-brand-muted">Nothing to review right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/business-verifications/${p.id}`}
                className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-3 text-sm hover:bg-brand-bg"
              >
                <span className="text-brand-ink">{p.businessName ?? "Unknown business"}</span>
                <span className="text-brand-muted">{new Date(p.createdAt).toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
