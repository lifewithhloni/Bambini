import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getMyBusinesses } from "@/server/business/getMyBusinesses";
import { BusinessVerificationBadge } from "@/components/business/BusinessHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingBag, ChevronRight } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

export const dynamic = "force-dynamic";

/**
 * A user may own or belong to several businesses — each is listed by name
 * with its own verification status and the user's role in it (owner vs
 * team member, from ownership only), and every management page under it
 * names the business it's managing. This page never merges anything
 * across businesses, or with the user's personal /sell area.
 */
export default async function MyBusinessesPage() {
  const user = await requireUser("/account/business");
  const businesses = await getMyBusinesses(user.id);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-heading-page text-brand-ink">Your businesses</h1>
        <p className="mt-1 text-body-small text-brand-muted">Sell as a registered business storefront alongside your personal listings.</p>
      </div>

      {businesses.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="You don't manage a business yet" description="Start one to sell as a registered storefront." />
      ) : (
        <ul className="flex flex-col gap-2">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link href={`/account/business/${b.id}`} className="block">
                <Card interactive>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="truncate text-body-small font-medium text-brand-ink">{b.businessName}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <BusinessVerificationBadge status={b.verificationStatus} />
                        <Badge tone="info">{b.isOwner ? "Owner" : "Team member"}</Badge>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href="/account/business/new" className={buttonVariants({ variant: "primary", size: "md", fullWidth: true })}>
        Start a business
      </Link>

      <Link href="/account" className="text-center text-body-small text-brand-muted hover:underline">
        Back to account
      </Link>
    </div>
  );
}
