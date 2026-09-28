import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getMyListings } from "@/server/listings/getMyListings";
import { getSellerOrders } from "@/server/orders/getSellerOrders";
import { getMyAvailableBalance } from "@/server/payouts/getMyAvailableBalance";
import { getMyBusinesses } from "@/server/business/getMyBusinesses";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { sellerOrderNeedsAction } from "@/lib/orders/sellerOrderBucket";
import { SellerNav } from "@/components/sell/SellerNav";
import { SellerOrderCard } from "@/components/orders/SellerOrderCard";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCentsAsRand } from "@/server/listings/price";
import { PlusCircle, ShoppingBag, Banknote } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

// Shows one specific user's own selling activity — never statically
// cached across visitors, same reasoning as every other per-user
// dashboard in this app.
export const dynamic = "force-dynamic";

function StatCard({ label, value, href }: { label: string; value: string | number; href: string }) {
  return (
    <Link href={href} className="flex flex-1 flex-col gap-0.5 rounded-card bg-brand-surface p-3 shadow-subtle transition-shadow duration-150 ease-bambini hover:shadow-elevated">
      <span className="text-heading-card text-brand-ink">{value}</span>
      <span className="text-caption text-brand-muted">{label}</span>
    </Link>
  );
}

export default async function SellDashboardPage() {
  const user = await requireUser("/sell");
  const [listings, orders, availableCents, businesses] = await Promise.all([
    getMyListings(user.id),
    getSellerOrders(user.id),
    getMyAvailableBalance(),
    getMyBusinesses(user.id),
  ]);

  const activeListingsCount = listings.filter((l) => l.status === "published").length;
  const ordersNeedingAction = orders.filter((o) =>
    sellerOrderNeedsAction({ status: o.status, paymentMethod: o.payment_method, fulfilmentType: o.fulfilment_type, hasActiveDispute: o.hasActiveDispute }),
  );
  const completedSalesCount = orders.filter((o) => o.status === "completed").length;
  const recentOrders = orders.slice(0, 3);

  const recentCoverPaths = recentOrders.map((o) => o.coverImagePath).filter((p): p is string => !!p);
  const imageUrls = await getSignedImageUrls(recentCoverPaths);

  const hasAnyActivity = listings.length > 0 || orders.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <SellerNav />

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-heading-page text-brand-ink">Selling</h1>
        <Link href="/sell/new" className={buttonVariants({ variant: "primary", size: "sm" })}>
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          New listing
        </Link>
      </div>

      {!hasAnyActivity ? (
        <EmptyState
          icon={ShoppingBag}
          title="You haven't listed anything yet"
          description="Sell something your kids have outgrown."
          action={
            <Link href="/sell/new" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Create your first listing
            </Link>
          }
        />
      ) : (
        <>
          {ordersNeedingAction.length > 0 ? (
            <Alert tone="info">
              <Link href="/sell/orders" className="font-medium underline">
                {ordersNeedingAction.length} order{ordersNeedingAction.length === 1 ? "" : "s"} need{ordersNeedingAction.length === 1 ? "s" : ""} your attention
              </Link>
            </Alert>
          ) : (
            orders.length > 0 && <Alert tone="success">You&apos;re all caught up.</Alert>
          )}

          <div className="flex gap-2">
            <StatCard label="Active listings" value={activeListingsCount} href="/sell/listings" />
            <StatCard label="Needs action" value={ordersNeedingAction.length} href="/sell/orders" />
            <StatCard label="Completed sales" value={completedSalesCount} href="/sell/orders" />
          </div>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-caption text-brand-muted">Available to withdraw</p>
                <p className="text-heading-card text-brand-ink">{formatCentsAsRand(availableCents)}</p>
              </div>
              <Link href="/sell/payouts" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Banknote className="h-4 w-4" aria-hidden="true" />
                Payouts
              </Link>
            </div>
          </Card>

          {recentOrders.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-heading-card text-brand-ink">Recent orders</h2>
                <Link href="/sell/orders" className="text-body-small font-medium text-bambini-forest hover:underline">
                  View all
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {recentOrders.map((order) => (
                  <SellerOrderCard key={order.id} order={order} imageUrl={order.coverImagePath ? (imageUrls[order.coverImagePath] ?? null) : null} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {businesses.length > 0 && (
        <p className="text-caption text-brand-muted">
          Also selling as{" "}
          <Link href="/account/business" className="font-medium text-bambini-forest hover:underline">
            {businesses.map((b) => b.businessName).join(", ")}
          </Link>
        </p>
      )}
    </div>
  );
}
