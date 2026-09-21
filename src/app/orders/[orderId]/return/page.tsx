import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getOrder } from "@/server/orders/getOrder";
import { formatCentsAsRand } from "@/server/listings/price";

// Depends on live payment/order state — never statically cached.
export const dynamic = "force-dynamic";

/**
 * The buyer lands here after being redirected back from PayFast — this
 * page deliberately never reads or trusts any query string PayFast
 * might attach (the Custom Integration flow this project uses doesn't
 * document one anyway) and never mutates payment/order state itself.
 * The only thing that ever confirms payment is the verified webhook
 * (process_payfast_itn(), called from the server-to-server ITN route)
 * having already run by the time this page loads — this page only
 * *displays* whatever Bambini's own database currently says, which may
 * still be "pending" if the webhook hasn't landed yet (it's typically
 * sent before the browser redirect, but that's not guaranteed timing).
 */
export default async function PaymentReturnPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireUser(`/orders/${orderId}/return`);

  const order = await getOrder(orderId);
  if (!order || order.buyer_id !== user.id) notFound();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">
        {order.payment_status === "paid"
          ? "Payment successful"
          : order.payment_status === "failed"
            ? "Payment not completed"
            : "Confirming your payment"}
      </h1>

      {order.payment_status === "paid" && (
        <p className="rounded-lg bg-brand-sage/20 px-3 py-2 text-sm text-brand-ink">
          Your payment for order {order.order_reference} has been confirmed.
        </p>
      )}

      {order.payment_status === "failed" && (
        <>
          <p className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
            Your payment wasn&apos;t completed. No charge was made.
          </p>
          <Link
            href={`/orders/${orderId}/pay`}
            className="w-full rounded-full bg-brand-sage-dark px-4 py-3 text-center text-sm font-medium text-white hover:bg-brand-sage"
          >
            Try again
          </Link>
        </>
      )}

      {order.payment_status !== "paid" && order.payment_status !== "failed" && (
        <>
          <p className="rounded-lg bg-brand-border px-3 py-2 text-sm text-brand-ink">
            Payment is being confirmed. This can take a minute — refresh to check again.
          </p>
          <a
            href={`/orders/${orderId}/return`}
            className="w-full rounded-full border border-brand-sage-dark px-4 py-3 text-center text-sm font-medium text-brand-ink hover:bg-brand-bg"
          >
            Refresh
          </a>
        </>
      )}

      <div className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-3 text-sm">
        <span className="text-brand-muted">Total</span>
        <span className="text-brand-ink">{formatCentsAsRand(order.total_cents)}</span>
      </div>

      <Link href={`/account/orders/${orderId}`} className="text-center text-sm text-brand-muted hover:underline">
        View order details
      </Link>
    </div>
  );
}
