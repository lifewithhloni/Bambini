import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getMyOrders } from "@/server/orders/getMyOrders";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { OrdersFilterList } from "@/components/orders/OrdersFilterList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingBag } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

// Shows one specific signed-in user's own orders — never statically
// cached, same reasoning as every other per-user dashboard in this app.
export const dynamic = "force-dynamic";

export default async function MyOrdersPage() {
  const user = await requireUser("/account/orders");
  const orders = await getMyOrders(user.id);

  const coverPaths = orders.map((o) => o.coverImagePath).filter((p): p is string => !!p);
  const imageUrls = await getSignedImageUrls(coverPaths);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-heading-page text-brand-ink">Your orders</h1>

      {orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No orders yet"
          description="When you buy something, it'll show up here."
          action={
            <Link href="/search" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Start browsing
            </Link>
          }
        />
      ) : (
        <OrdersFilterList orders={orders} imageUrls={imageUrls} />
      )}
    </div>
  );
}
