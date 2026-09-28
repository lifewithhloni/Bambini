import { getOrderDispute } from "@/server/disputes/getOrderDispute";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { OrderDetailView } from "./OrderDetailView";
import { CashOrderActions } from "./CashOrderActions";
import { ConfirmCollectionForm } from "./ConfirmCollectionForm";
import { DisputeSection } from "./DisputeSection";
import type { OrderDetail } from "@/server/orders/getOrder";

/**
 * The seller-framed order detail body, shared by /sell/orders/[id] and
 * /account/business/[id]/orders/[orderId] so there is exactly one copy of
 * which actions appear when — the caller is responsible for having
 * already confirmed the viewer is a seller of this order (both pages do,
 * via viewerIsOrderSeller() / requireBusinessAccess() + order ownership);
 * every action here still re-authorizes server-side regardless.
 */
export async function SellerOrderDetailSections({ order }: { order: OrderDetail }) {
  const imageUrls = order.item?.coverImagePath ? await getSignedImageUrls([order.item.coverImagePath]) : {};
  const imageUrl = order.item?.coverImagePath ? (imageUrls[order.item.coverImagePath] ?? null) : null;
  const dispute = await getOrderDispute(order.id);

  return (
    <>
      <OrderDetailView order={order} viewerRole="seller" imageUrl={imageUrl} />

      <DisputeSection orderId={order.id} orderStatus={order.status} dispute={dispute} viewerRole="seller" />

      {order.payment_method === "cash" && order.status === "pending_payment" && <CashOrderActions orderId={order.id} />}

      {order.fulfilment_type === "collection" && order.status === "confirmed" && <ConfirmCollectionForm orderId={order.id} />}
    </>
  );
}
