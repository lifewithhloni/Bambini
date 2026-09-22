import Image from "next/image";
import { formatCentsAsRand } from "@/server/listings/price";
import { OrderStatusBadge, PaymentStatusBadge } from "./OrderStatusBadge";
import type { OrderDetail } from "@/server/orders/getOrder";

/**
 * Shared by both /account/orders/[id] (buyer) and /sell/orders/[id]
 * (seller) — same order, same RLS-scoped read (getOrder.ts), only the
 * framing differs: commission is only ever rendered for viewerRole ===
 * "seller" (see DATABASE.md/the phase brief — a buyer has no product
 * reason to see the marketplace's internal commission math on their own
 * purchase).
 */
export function OrderDetailView({
  order,
  viewerRole,
  imageUrl,
}: {
  order: OrderDetail;
  viewerRole: "buyer" | "seller";
  imageUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-brand-muted">Order {order.order_reference}</p>
          <p className="text-xs text-brand-muted">{new Date(order.created_at).toLocaleString()}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.payment_status} />
        </div>
      </div>

      {order.item && (
        <div className="flex gap-3 rounded-lg border border-brand-border bg-white p-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-brand-bg">
            {imageUrl ? (
              <Image src={imageUrl} alt="" width={80} height={80} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-brand-muted">No photo</div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate font-medium text-brand-ink">{order.item.title}</p>
            <p className="text-sm text-brand-ink">{formatCentsAsRand(order.item.priceCents)}</p>
            <p className="text-xs text-brand-muted">Qty 1</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">{viewerRole === "buyer" ? "Seller" : "Buyer"}</span>
          <span className="text-brand-ink">{(viewerRole === "buyer" ? order.sellerName : order.buyerName) ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Fulfilment</span>
          <span className="text-brand-ink capitalize">{order.fulfilment_type}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Payment method</span>
          <span className="text-brand-ink">{order.payment_method === "cash" ? "Cash on collection" : "Online (PayFast)"}</span>
        </div>
        {order.fulfilment_type === "collection" && order.pickupLocation?.suburb && (
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Collect from</span>
            <span className="text-brand-ink">
              {[order.pickupLocation.suburb, order.pickupLocation.city].filter(Boolean).join(", ")}
            </span>
          </div>
        )}
        {order.fulfilment_type === "delivery" && order.deliveryTracking && (
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Delivery status</span>
            <span className="text-brand-ink">{order.deliveryTracking.label}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Subtotal</span>
          <span className="text-brand-ink">{formatCentsAsRand(order.subtotal_cents)}</span>
        </div>
        {order.fulfilment_type === "delivery" && (
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Delivery fee</span>
            <span className="text-brand-ink">{formatCentsAsRand(order.delivery_fee_cents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between font-semibold">
          <span className="text-brand-ink">Total</span>
          <span className="text-brand-ink">{formatCentsAsRand(order.total_cents)}</span>
        </div>
      </div>

      {viewerRole === "seller" && (
        <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-brand-muted">Commission</p>
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Rate</span>
            <span className="text-brand-ink">{(order.commission_rate_bps / 100).toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Marketplace commission</span>
            <span className="text-brand-ink">{formatCentsAsRand(order.commission_amount_cents)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold">
            <span className="text-brand-ink">You receive</span>
            {/* Phase 7A: the delivery fee is the courier's, never the
                seller's — subtotal_cents (not total_cents) is what
                commission is deducted from, both here and in
                create_order()'s own commission calculation. */}
            <span className="text-brand-ink">{formatCentsAsRand(order.subtotal_cents - order.commission_amount_cents)}</span>
          </div>
          {order.commission_settlement_status === "owed_by_seller" && (
            <p className="mt-1 text-xs text-brand-muted">
              You collect the full amount in cash — this commission is still owed to Bambini and isn&apos;t deducted automatically.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
