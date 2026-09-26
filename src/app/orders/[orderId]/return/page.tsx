import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getOrder } from "@/server/orders/getOrder";
import { formatCentsAsRand } from "@/server/listings/price";
import { Card } from "@/components/ui/Card";
import { Check, AlertTriangle, Loader2 } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";
import { PaymentProcessingAutoRefresh } from "./PaymentProcessingAutoRefresh";

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
 * A buyer's mere presence on this return URL is never itself treated as
 * proof of anything (see Phase 12C's own brief: "the browser return URL
 * is NOT authoritative").
 */
export default async function PaymentReturnPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireUser(`/orders/${orderId}/return`);

  const order = await getOrder(orderId);
  if (!order || order.buyer_id !== user.id) notFound();

  const isPaid = order.payment_status === "paid";
  const isFailed = order.payment_status === "failed";
  const isProcessing = !isPaid && !isFailed;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      {isProcessing && <PaymentProcessingAutoRefresh />}

      <div className="flex flex-col items-center gap-3 rounded-card border border-brand-border bg-brand-surface px-6 py-10 text-center">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            isPaid ? "bg-brand-sage-dark/15" : isFailed ? "bg-brand-danger/10" : "bg-brand-light-sage"
          }`}
        >
          {isPaid && <Check className="h-6 w-6 text-brand-sage-dark" aria-hidden="true" strokeWidth={2.5} />}
          {isFailed && <AlertTriangle className="h-6 w-6 text-brand-danger" aria-hidden="true" />}
          {isProcessing && <Loader2 className="h-6 w-6 animate-spin text-bambini-forest" aria-hidden="true" />}
        </div>

        <div className="flex flex-col gap-1">
          <p role={isFailed ? "alert" : "status"} className="text-heading-card text-brand-ink">
            {isPaid ? "Payment confirmed" : isFailed ? "Payment not completed" : "Confirming your payment"}
          </p>
          <p className="text-body-small text-brand-muted">
            {isPaid && `Your payment for order ${order.order_reference} has been confirmed.`}
            {isFailed && "Your payment wasn't completed. No charge was made."}
            {isProcessing && "This usually only takes a few seconds — this page will update automatically."}
          </p>
        </div>

        {isFailed && (
          <Link href={`/orders/${orderId}/pay`} className={buttonVariants({ variant: "primary", size: "md" })}>
            Try again
          </Link>
        )}
      </div>

      <Card elevation="subtle">
        <div className="flex items-center justify-between text-body-small">
          <span className="text-brand-muted">Total</span>
          <span className="text-brand-ink">{formatCentsAsRand(order.total_cents)}</span>
        </div>
      </Card>

      <Link href={`/account/orders/${orderId}`} className="text-center text-body-small text-brand-muted hover:underline">
        View order details
      </Link>
    </div>
  );
}
