import { requireUser } from "@/server/auth/requireUser";
import { getSellerOrders } from "@/server/orders/getSellerOrders";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { SellerNav } from "@/components/sell/SellerNav";
import { SellerOrdersFilterList } from "@/components/orders/SellerOrdersFilterList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingBag } from "@/components/ui/icons";

// Shows orders for the signed-in user's own listings — never statically
// cached, same reasoning as every other per-user dashboard in this app.
export const dynamic = "force-dynamic";

export default async function SellerOrdersPage() {
  const user = await requireUser("/sell/orders");
  const orders = await getSellerOrders(user.id);

  const coverPaths = orders.map((o) => o.coverImagePath).filter((p): p is string => !!p);
  const imageUrls = await getSignedImageUrls(coverPaths);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <SellerNav />
      <h1 className="text-heading-page text-brand-ink">Orders</h1>

      {orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders yet" description="Your sales will appear here." />
      ) : (
        <SellerOrdersFilterList orders={orders} imageUrls={imageUrls} />
      )}
    </div>
  );
}
