import Image from "next/image";
import Link from "next/link";
import { OrderStatusBadge, PaymentStatusBadge } from "./OrderStatusBadge";
import { formatCentsAsRand } from "@/server/listings/price";
import { getNextSellerOrderAction } from "@/lib/orders/nextSellerOrderAction";
import { ImageOff, ChevronRight } from "@/components/ui/icons";
import type { SellerOrderSummary } from "@/server/orders/getSellerOrders";

/**
 * The seller-side counterpart to OrderCard.tsx — every field comes
 * straight from getSellerOrders()'s own already-authoritative summary;
 * the "next action" label is presentation only, never itself an
 * authorization decision.
 */
export function SellerOrderCard({ order, imageUrl, hrefBase = "/sell/orders" }: { order: SellerOrderSummary; imageUrl: string | null; hrefBase?: string }) {
  const action = getNextSellerOrderAction({
    status: order.status,
    paymentMethod: order.payment_method,
    fulfilmentType: order.fulfilment_type,
    hasActiveDispute: order.hasActiveDispute,
  });

  return (
    <Link
      href={`${hrefBase}/${order.id}`}
      className="flex gap-3 rounded-card bg-brand-surface p-3 shadow-subtle transition-shadow duration-150 ease-bambini hover:shadow-elevated"
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-image bg-brand-cream">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-brand-muted">
            <ImageOff className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-body-small font-medium text-brand-ink">{order.productTitle ?? "Order"}</p>
          <span className="shrink-0 text-caption text-brand-muted">{order.order_reference}</span>
        </div>

        {order.buyerName && <p className="truncate text-caption text-brand-muted">{order.buyerName}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.payment_status} />
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-price text-brand-ink">{formatCentsAsRand(order.total_cents)}</span>
          <span className="flex shrink-0 items-center gap-0.5 text-caption font-medium text-bambini-forest">
            {action.label}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
