import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessOrderDetail } from "@/server/orders/getBusinessOrderDetail";
import { SellerOrderDetailSections } from "@/components/orders/SellerOrderDetailSections";
import { ChevronLeft } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Two independent server checks, neither trusting the URL: the caller must
 * be the owner or a member of THIS business (requireBusinessAccess() — RLS
 * read, 404 otherwise), and the order must belong to this business
 * (getBusinessOrderDetail() compares the order's own business_id to the
 * route's id, 404 otherwise). A member of business A therefore can't reach
 * business B's order by editing either segment, and a personal seller's
 * order is never reachable through a business route at all. The body is
 * the same shared component /sell/orders/[id] renders — one set of order
 * actions, not a second copy.
 */
export default async function BusinessOrderDetailPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  await requireBusinessAccess(id, `/account/business/${id}/orders/${orderId}`);

  const order = await getBusinessOrderDetail(id, orderId);
  if (!order) notFound();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <Link href={`/account/business/${id}/orders`} className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to business orders
      </Link>
      <h1 className="text-heading-page text-brand-ink">Order details</h1>
      <SellerOrderDetailSections order={order} />
    </div>
  );
}
