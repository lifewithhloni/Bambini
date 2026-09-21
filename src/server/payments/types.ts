export type CreateCheckoutRequest = {
  orderId: string;
  amountCents: number;
  currency: string;
  returnUrl: string;
  /** Optional because the mock adapter never uses them — PayFast requires all three (cancel_url, notify_url, item_name are part of its documented checkout fields; item_name specifically is REQUIRED by PayFast). Added here rather than left provider-specific because "what happens if the buyer cancels" / "where do webhooks go" / "what does the buyer see on the provider's page" are checkout concerns every real provider will need some version of, not PayFast-only ones. */
  cancelUrl?: string;
  notifyUrl?: string;
  itemName?: string;
};

export type CheckoutSession = {
  providerSlug: string;
  providerReference: string;
  /** The URL to send the buyer's browser to. For a plain GET-redirect provider (the mock adapter) this is enough on its own. */
  redirectUrl: string;
  /** Present only when the provider's checkout requires an HTML form POST rather than a simple GET redirect (PayFast's documented "Custom Integration" flow is exactly this: a hidden form posting to redirectUrl). The client renders these as hidden inputs on a `<form method="post" action={redirectUrl}>` — never a fetch/XHR, since the browser itself must navigate to the provider's hosted page. Absent for a GET-redirect provider. */
  formFields?: Record<string, string>;
};

export type WebhookVerificationResult =
  | {
      valid: true;
      providerReference: string;
      /** The merchant-side reference the provider echoes back — how the webhook is correlated to a specific Bambini order before any DB lookup happens. PayFast: m_payment_id. */
      merchantReference: string;
      status: "paid" | "failed" | "refunded";
      /** Parsed from the provider's own reported amount, never trusted from anywhere else — the route handler compares this against orders.total_cents before touching any DB state. */
      amountCents: number;
    }
  | { valid: false; reason: string };

export type RefundResult = {
  providerReference: string;
  status: "refunded" | "partially_refunded" | "failed";
};

/**
 * Every payment provider (PayFast, Yoco, Stripe, ...) implements this.
 * Order totals, commission, and payout amounts are always computed
 * server-side from trusted DB state before this interface is ever
 * called — a provider adapter only moves money and reports status, it
 * never decides amounts.
 */
export interface PaymentProvider {
  readonly slug: string;
  createCheckout(request: CreateCheckoutRequest): Promise<CheckoutSession>;
  verifyWebhook(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<WebhookVerificationResult>;
  refund(providerReference: string, amountCents: number): Promise<RefundResult>;
}
