export type CreateCheckoutRequest = {
  orderId: string;
  amountCents: number;
  currency: string;
  returnUrl: string;
};

export type CheckoutSession = {
  providerSlug: string;
  providerReference: string;
  redirectUrl: string;
};

export type WebhookVerificationResult =
  | { valid: true; providerReference: string; status: "paid" | "failed" | "refunded" }
  | { valid: false };

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
