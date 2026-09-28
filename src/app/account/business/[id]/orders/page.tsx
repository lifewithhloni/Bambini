import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessOrders } from "@/server/orders/getSellerOrders";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { SellerOrdersFilterList } from "@/components/orders/SellerOrdersFilterList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingBag } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Order cards link to /account/business/[id]/orders/[orderId], which keeps
 * the user inside this business's context and re-verifies both the
 * caller's access to the business and that the order belongs to it. That
 * page renders the same shared SellerOrderDetailSections the personal
 * /sell/orders/[id] uses, so cash accept/decline, collection
 * confirmation, delivery tracking, and disputes stay one implementation.
 */
export default async function BusinessOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}/orders`);
  const orders = await getBusinessOrders(id);
  const imageUrls = await getSignedImageUrls(orders.map((o) => o.coverImagePath).filter((p): p is string => !!p));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />
      <h2 className="text-heading-card text-brand-ink">Orders</h2>
      {orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders yet" description="Your business hasn't received any orders yet." />
      ) : (
        <SellerOrdersFilterList orders={orders} imageUrls={imageUrls} hrefBase={`/account/business/${business.id}/orders`} />
      )}
    </div>
  );
}
