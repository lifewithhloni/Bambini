import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { createClient } from "@/lib/supabase/server";
import { getOrder, type OrderDetail } from "@/server/orders/getOrder";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { OrderDetailView } from "@/components/orders/OrderDetailView";

// One specific signed-in seller's own order — never statically cached.
export const dynamic = "force-dynamic";

/**
 * RLS already guarantees getOrder() only ever returns a row the caller
 * participates in (buyer, seller, or admin) — but that alone doesn't
 * distinguish *which* role the caller has, and this route renders
 * commission info that must never reach a buyer just because they
 * happen to also be able to read the row (e.g. by navigating here for
 * an order they bought, not sold). This explicitly confirms seller
 * ownership before rendering the seller-framed view, the same
 * business-membership resolution getSellerOrders.ts/getMyListings.ts
 * already use.
 */
async function viewerIsOrderSeller(order: OrderDetail, userId: string): Promise<boolean> {
  if (order.seller_profile_id === userId) return true;
  if (!order.business_id) return false;

  const supabase = await createClient();
  const [{ data: owned }, { data: member }] = await Promise.all([
    supabase.from("businesses").select("id").eq("id", order.business_id).eq("owner_profile_id", userId).maybeSingle(),
    supabase.from("business_members").select("business_id").eq("business_id", order.business_id).eq("profile_id", userId).maybeSingle(),
  ]);
  return !!owned || !!member;
}

export default async function SellerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/sell/orders/${id}`);

  const order = await getOrder(id);
  if (!order) notFound();

  const isSeller = await viewerIsOrderSeller(order, user.id);
  if (!isSeller) notFound();

  const imageUrls = order.item?.coverImagePath ? await getSignedImageUrls([order.item.coverImagePath]) : {};
  const imageUrl = order.item?.coverImagePath ? (imageUrls[order.item.coverImagePath] ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">Order details</h1>
      <OrderDetailView order={order} viewerRole="seller" imageUrl={imageUrl} />
    </div>
  );
}
