import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getSellerOrders } from "@/server/orders/getSellerOrders";
import { formatCentsAsRand } from "@/server/listings/price";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/orders/OrderStatusBadge";

// Shows orders for the signed-in user's own listings — never statically
// cached, same reasoning as every other per-user dashboard in this app.
export const dynamic = "force-dynamic";

export default async function SellerOrdersPage() {
  const user = await requireUser("/sell/orders");
  const orders = await getSellerOrders(user.id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold text-brand-ink">Orders</h1>

      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border px-4 py-10 text-center">
          <p className="text-brand-ink">No orders yet.</p>
          <p className="mt-1 text-sm text-brand-muted">Orders for your listings will show up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/sell/orders/${order.id}`}
              className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3 hover:border-brand-sage-dark"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium text-brand-ink">{order.productTitle ?? "Order"}</p>
                <span className="shrink-0 text-xs text-brand-muted">{order.order_reference}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.payment_status} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-muted">{order.buyerName ?? "Buyer"}</span>
                <span className="font-semibold text-brand-ink">{formatCentsAsRand(order.total_cents)}</span>
              </div>
              <p className="text-xs text-brand-muted">
                {order.fulfilment_type === "collection" ? "Collection" : "Delivery"} · {new Date(order.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
