import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getMyBusinesses } from "@/server/business/getMyBusinesses";

export const dynamic = "force-dynamic";

export default async function MyBusinessesPage() {
  const user = await requireUser("/account/business");
  const businesses = await getMyBusinesses(user.id);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Your businesses</h1>
        <p className="mt-1 text-sm text-brand-muted">Sell as a registered business storefront alongside your personal listings.</p>
      </div>

      {businesses.length === 0 ? (
        <p className="text-sm text-brand-muted">You don&apos;t manage a business yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link
                href={`/account/business/${b.id}`}
                className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-3 text-sm hover:bg-brand-bg"
              >
                <span className="text-brand-ink">{b.businessName}</span>
                <span className="text-xs capitalize text-brand-muted">{b.verificationStatus}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/account/business/new"
        className="rounded-full bg-brand-sage-dark px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-sage"
      >
        Start a business
      </Link>

      <Link href="/account" className="text-center text-sm text-brand-muted hover:underline">
        Back to account
      </Link>
    </div>
  );
}
