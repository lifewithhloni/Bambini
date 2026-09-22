import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getOrder } from "@/server/orders/getOrder";
import { getOrderDispute } from "@/server/disputes/getOrderDispute";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { CollectionCodeDisplay } from "@/components/orders/CollectionCodeDisplay";
import { DisputeSection } from "@/components/orders/DisputeSection";

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

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">Order details</h1>
      <OrderDetailView order={order} viewerRole="buyer" imageUrl={imageUrl} />

      <DisputeSection orderId={order.id} orderStatus={order.status} dispute={dispute} viewerRole="buyer" />

      {order.fulfilment_type === "collection" && order.status === "confirmed" && <CollectionCodeDisplay orderId={order.id} />}

      {order.payment_method === "online" && (order.payment_status === "pending" || order.payment_status === "failed") && (
        <Link
          href={`/orders/${id}/pay`}
          className="w-full rounded-full bg-brand-sage-dark px-4 py-3 text-center text-sm font-medium text-white hover:bg-brand-sage"
        >
          {order.payment_status === "failed" ? "Try payment again" : "Pay now"}
        </Link>
      )}
      {order.payment_method === "cash" && order.status === "pending_payment" && (
        <p className="rounded-lg bg-brand-border px-3 py-2 text-center text-sm text-brand-ink">
          Waiting for the seller to accept your cash order.
        </p>
      )}
    </div>
  );
}
