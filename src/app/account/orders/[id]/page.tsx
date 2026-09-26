import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getOrder } from "@/server/orders/getOrder";
import { getOrderDispute } from "@/server/disputes/getOrderDispute";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { CollectionCodeDisplay } from "@/components/orders/CollectionCodeDisplay";
import { DisputeSection } from "@/components/orders/DisputeSection";
import { CancelOrderButton } from "@/components/orders/CancelOrderButton";
import { Alert } from "@/components/ui/Alert";
import { buttonVariants } from "@/lib/ui/variants";

// One specific signed-in user's own order — never statically cached.
export const dynamic = "force-dynamic";

export default async function BuyerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/orders/${id}`);

  const order = await getOrder(id);
  // RLS already only ever returns a row the caller participates in
  // (buyer, seller, or admin) — this re-checks buyer_id specifically so
  // a seller visiting their own order's id under /account/orders/ (the
  // buyer-framed route) gets a clean not-found rather than a
  // buyer-labelled view of an order that isn't theirs to buy.
  if (!order || order.buyer_id !== user.id) notFound();

  const imageUrls = order.item?.coverImagePath ? await getSignedImageUrls([order.item.coverImagePath]) : {};
  const imageUrl = order.item?.coverImagePath ? (imageUrls[order.item.coverImagePath] ?? null) : null;
  const dispute = await getOrderDispute(order.id);

  // Mirrors cancel_pending_delivery_order()'s own eligibility exactly
  // (see 20261001090000_delivery_reliability.sql) — a UI convenience for
  // showing/hiding the button; the RPC re-validates independently
  // regardless. Already offered on /orders/[orderId]/pay; surfaced here
  // too so a buyer looking at their order (not mid-payment-flow) can
  // still find it.
  const canCancel = order.fulfilment_type === "delivery" && order.status === "pending_payment";

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-heading-page text-brand-ink">Order details</h1>
      <OrderDetailView order={order} viewerRole="buyer" imageUrl={imageUrl} />

      <DisputeSection orderId={order.id} orderStatus={order.status} dispute={dispute} viewerRole="buyer" />

      {order.fulfilment_type === "collection" && order.status === "confirmed" && <CollectionCodeDisplay orderId={order.id} />}

      {order.payment_method === "online" && (order.payment_status === "pending" || order.payment_status === "failed") && (
        <Link href={`/orders/${id}/pay`} className={buttonVariants({ variant: "primary", size: "lg", fullWidth: true })}>
          {order.payment_status === "failed" ? "Try payment again" : "Continue payment"}
        </Link>
      )}
      {order.payment_method === "cash" && order.status === "pending_payment" && (
        <Alert tone="info">Waiting for the seller to accept your cash order.</Alert>
      )}

      {canCancel && <CancelOrderButton orderId={order.id} />}
    </div>
  );
}
