import Link from "next/link";
import { requireAdmin } from "@/server/auth/requireAdmin";
import { getAdminOverview } from "@/server/admin/getAdminOverview";
import { getMarketplaceOverview } from "@/server/admin/getMarketplaceOverview";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Check, PackageCheck, AlertTriangle, Banknote, Truck, SlidersHorizontal, CreditCard, ChevronRight, User, ShoppingBag } from "@/components/ui/icons";
import type { BadgeTone } from "@/lib/ui/variants";
import type { ComponentType } from "react";

// A live admin overview — never statically cached.
export const dynamic = "force-dynamic";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function AttentionCard({ label, count, href, icon: Icon }: { label: string; count: number; href: string; icon: IconType }) {
  const needsAttention = count > 0;
  const tone: BadgeTone = needsAttention ? "danger" : "neutral";

  return (
    <Link href={href} className="block">
      <Card interactive className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${needsAttention ? "bg-bambini-coral/20" : "bg-brand-light-sage"}`}>
          <Icon className={`h-5 w-5 ${needsAttention ? "text-bambini-coral" : "text-bambini-forest"}`} aria-hidden={true} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-heading-card text-brand-ink">{count}</span>
          <span className="truncate text-body-small text-brand-muted">{label}</span>
        </div>
        {needsAttention && <Badge tone={tone}>Needs review</Badge>}
      </Card>
    </Link>
  );
}

function StatCard({ label, count, icon: Icon }: { label: string; count: number; icon: IconType }) {
  return (
    <Card className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light-sage">
        <Icon className="h-4 w-4 text-bambini-forest" aria-hidden={true} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-heading-card text-brand-ink">{count.toLocaleString()}</span>
        <span className="truncate text-caption text-brand-muted">{label}</span>
      </div>
    </Card>
  );
}

function NavCard({ label, description, href, icon: Icon }: { label: string; description: string; href: string; icon: IconType }) {
  return (
    <Link href={href} className="block">
      <Card interactive className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light-sage">
          <Icon className="h-4 w-4 text-bambini-forest" aria-hidden={true} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-small font-medium text-brand-ink">{label}</span>
          <span className="truncate text-caption text-brand-muted">{description}</span>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />
      </Card>
    </Link>
  );
}

/**
 * The admin landing page this codebase never had (see Phase 17's own
 * repository audit) — purely additive navigation/overview, no new
 * authorization model. requireAdmin() here gates this page directly, with
 * the correct redirect-back path for a signed-out visitor; getAdminOverview()
 * independently calls it again for its own data (the same defense-in-depth
 * pattern every admin data function in this codebase already follows) —
 * a non-admin gets the identical notFound() 404 every other admin route
 * already gives, never a different behavior.
 */
export default async function AdminDashboardPage() {
  await requireAdmin("/admin");
  const [counts, marketplace] = await Promise.all([getAdminOverview(), getMarketplaceOverview()]);

  const overview: { label: string; count: number; icon: IconType }[] = [
    { label: "Total accounts", count: marketplace.totalAccounts, icon: User },
    { label: "Verified accounts", count: marketplace.verifiedAccounts, icon: Check },
    { label: "Business accounts", count: marketplace.businessAccounts, icon: PackageCheck },
    { label: "Active listings", count: marketplace.activeListings, icon: ShoppingBag },
    { label: "Completed orders", count: marketplace.completedOrders, icon: CreditCard },
  ];

  const attention: { label: string; count: number; href: string; icon: IconType }[] = [
    { label: "Pending identity verifications", count: counts.pendingIdentityVerifications, href: "/admin/verifications", icon: Check },
    { label: "Pending business verifications", count: counts.pendingBusinessVerifications, href: "/admin/business-verifications", icon: PackageCheck },
    { label: "Open disputes", count: counts.openDisputes, href: "/admin/disputes", icon: AlertTriangle },
    { label: "Pending payouts", count: counts.pendingPayouts, href: "/admin/payouts", icon: Banknote },
    { label: "Delivery issues", count: counts.deliveryIssues, href: "/admin/delivery", icon: Truck },
  ];

  const sections: { label: string; description: string; href: string; icon: IconType }[] = [
    { label: "Identity Verification", description: "Review pending SA ID submissions.", href: "/admin/verifications", icon: Check },
    { label: "Business Verification", description: "Review pending business registration documents.", href: "/admin/business-verifications", icon: PackageCheck },
    { label: "Disputes", description: "Buyer-raised disputes against an order.", href: "/admin/disputes", icon: AlertTriangle },
    { label: "Payouts", description: "Process seller and business payout requests.", href: "/admin/payouts", icon: Banknote },
    { label: "Delivery", description: "Delivery bookings stuck without a provider response.", href: "/admin/delivery", icon: Truck },
    { label: "Delivery Settings", description: "Configure delivery markup pricing.", href: "/admin/delivery/settings", icon: SlidersHorizontal },
    { label: "Delivery Transactions", description: "Provider cost and markup financial records.", href: "/admin/delivery/transactions", icon: CreditCard },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-heading-page text-brand-ink">Bambini Admin</h1>
        <p className="mt-1 text-body-small text-brand-muted">Manage verification, disputes, payouts and delivery.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Marketplace overview</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {overview.map((o) => (
            <StatCard key={o.label} {...o} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Needs attention</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((a) => (
            <AttentionCard key={a.href} {...a} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Manage</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <NavCard key={s.href} {...s} />
          ))}
        </div>
      </section>
    </div>
  );
}
