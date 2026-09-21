import Link from "next/link";
import { listPendingVerifications } from "@/server/verification/adminVerifications";

// Live admin queue — never statically cached.
export const dynamic = "force-dynamic";

/**
 * Deliberately minimal — a single list of pending submissions, per the
 * brief's explicit "do not build a full admin dashboard" instruction.
 * requireAdmin() (inside listPendingVerifications()) 404s this whole
 * page for anyone who isn't an admin.
 */
export default async function AdminVerificationsPage() {
  const pending = await listPendingVerifications();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">Pending identity verifications</h1>

      {pending.length === 0 ? (
        <p className="text-sm text-brand-muted">Nothing to review right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/verifications/${p.id}`}
                className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-3 text-sm hover:bg-brand-bg"
              >
                <span className="text-brand-ink">{p.profileName ?? "Unknown user"}</span>
                <span className="text-brand-muted">{new Date(p.createdAt).toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
