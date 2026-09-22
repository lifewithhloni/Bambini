import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getOrder } from "@/server/orders/getOrder";
import { formatCentsAsRand } from "@/server/listings/price";
import { PayButton } from "./PayButton";
import { CancelOrderButton } from "./CancelOrderButton";

// Depends on the live payment/order state for this specific buyer —
// never statically cached.
export const dynamic = "force-dynamic";

export default async function PayForOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { orderId } = await params;
  const { cancelled } = await searchParams;
  const user = await requireUser(`/orders/${orderId}/pay`);

  const order = await getOrder(orderId);
  if (!order || order.buyer_id !== user.id) notFound();

  if (order.payment_status === "paid") {
    redirect(`/account/orders/${orderId}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">Pay for your order</h1>

      {/* Purely cosmetic — a cancelled-return notice, never treated as
          proof of anything or used to mutate payment state. The
          buyer's browser bouncing through cancel_url doesn't tell us
          anything authoritative; only a verified webhook does. */}
      {cancelled === "1" && (
        <p className="rounded-lg bg-brand-border px-3 py-2 text-sm text-brand-ink">
          Payment was cancelled. You can try again below.
        </p>
      )}

      <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Order</span>
          <span className="text-brand-ink">{order.order_reference}</span>
        </div>
        {order.item && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-brand-muted">Item</span>
            <span className="truncate text-brand-ink">{order.item.title}</span>
          </div>
        )}
        <div className="flex items-center justify-between font-semibold">
          <span className="text-brand-ink">Total</span>
          <span className="text-brand-ink">{formatCentsAsRand(order.total_cents)}</span>
        </div>
      </div>

      <p className="text-xs text-brand-muted">
        You&apos;ll be redirected to PayFast to complete payment securely. Bambini never sees or stores your card
        details.
      </p>

      <PayButton orderId={orderId} />

      {/* Phase 7B: cancellation is only ever offered here — before
          payment, before any delivery has been booked. Once paid, the
          order moves off this page entirely (see the payment_status
          redirect above), so this button can never coexist with a paid
          or booked order. */}
      {order.fulfilment_type === "delivery" && <CancelOrderButton orderId={orderId} />}

      <Link href={`/account/orders/${orderId}`} className="text-center text-sm text-brand-muted hover:underline">
        Back to order details
      </Link>
    </div>
  );
}
