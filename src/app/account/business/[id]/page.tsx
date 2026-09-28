import Link from "next/link";
import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessListings } from "@/server/listings/getBusinessListings";
import { getBusinessOrders } from "@/server/orders/getSellerOrders";
import { getBusinessAvailableBalance } from "@/server/payouts/getBusinessAvailableBalance";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { sellerOrderNeedsAction } from "@/lib/orders/sellerOrderBucket";
import { formatCentsAsRand } from "@/server/listings/price";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { SellerOrderCard } from "@/components/orders/SellerOrderCard";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingBag, Banknote, PlusCircle } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

export const dynamic = "force-dynamic";

function StatCard({ label, value, href }: { label: string; value: string | number; href: string }) {
  return (
    <Link href={href} className="flex flex-1 flex-col gap-0.5 rounded-card bg-brand-surface p-3 shadow-subtle transition-shadow duration-150 ease-bambini hover:shadow-elevated">
      <span className="text-heading-card text-brand-ink">{value}</span>
      <span className="text-caption text-brand-muted">{label}</span>
    </Link>
  );
}

/**
 * Only real, already-server-derived numbers: counts over this one
 * business's own listings/orders (RLS-scoped, business-filtered) and the
 * server-authoritative available balance. Nothing invented — no views,
 * conversion, growth, or charts, because no backend source for them exists.
 */
export default async function BusinessDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}`);

  const [listings, orders, availableCents] = await Promise.all([getBusinessListings(id), getBusinessOrders(id), getBusinessAvailableBalance(id)]);

  const activeListingsCount = listings.filter((l) => l.status === "published").length;
  const needingAction = orders.filter((o) =>
    sellerOrderNeedsAction({ status: o.status, paymentMethod: o.payment_method, fulfilmentType: o.fulfilment_type, hasActiveDispute: o.hasActiveDispute }),
  );
  const completedCount = orders.filter((o) => o.status === "completed").length;
  const recentOrders = orders.slice(0, 3);
  const imageUrls = await getSignedImageUrls(recentOrders.map((o) => o.coverImagePath).filter((p): p is string => !!p));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />

      {business.verificationStatus !== "verified" && (
        <Alert tone="info">
          Your storefront and listings become public once this business is verified.{" "}
          <Link href={`/account/business/${business.id}/settings`} className="font-medium underline">
            See verification
          </Link>
        </Alert>
      )}

      {needingAction.length > 0 ? (
        <Alert tone="info">
          <Link href={`/account/business/${business.id}/orders`} className="font-medium underline">
            {needingAction.length} order{needingAction.length === 1 ? "" : "s"} need{needingAction.length === 1 ? "s" : ""} your attention
          </Link>
        </Alert>
      ) : (
        orders.length > 0 && <Alert tone="success">You&apos;re all caught up.</Alert>
      )}

      <div className="flex gap-2">
        <StatCard label="Active listings" value={activeListingsCount} href={`/account/business/${business.id}/listings`} />
        <StatCard label="Needs action" value={needingAction.length} href={`/account/business/${business.id}/orders`} />
        <StatCard label="Completed sales" value={completedCount} href={`/account/business/${business.id}/orders`} />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-caption text-brand-muted">Available to withdraw</p>
            <p className="text-heading-card text-brand-ink">{formatCentsAsRand(availableCents)}</p>
          </div>
          <Link href={`/account/business/${business.id}/payouts`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Banknote className="h-4 w-4" aria-hidden="true" />
            Payouts
          </Link>
        </div>
      </Card>

      {orders.length === 0 && listings.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Your business has no listings yet"
          description="List your first item to start selling."
          action={
            <Link href="/sell/new" className={buttonVariants({ variant: "primary", size: "sm" })}>
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              New listing
            </Link>
          }
        />
      ) : recentOrders.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-heading-card text-brand-ink">Recent orders</h2>
            <Link href={`/account/business/${business.id}/orders`} className="text-body-small font-medium text-bambini-forest hover:underline">
              View all
            </Link>
          </div>
          {recentOrders.map((order) => (
            <SellerOrderCard key={order.id} order={order} hrefBase={`/account/business/${business.id}/orders`} imageUrl={order.coverImagePath ? (imageUrls[order.coverImagePath] ?? null) : null} />
          ))}
        </div>
      ) : (
        <EmptyState icon={ShoppingBag} title="No orders yet" description="Your business hasn't received any orders yet." />
      )}

      {business.verificationStatus === "verified" && (
        <p className="text-caption text-brand-muted">
          Public storefront:{" "}
          <Link href={`/business/${business.slug}`} className="font-medium text-bambini-forest hover:underline">
            /business/{business.slug}
          </Link>
        </p>
      )}
    </div>
  );
}
