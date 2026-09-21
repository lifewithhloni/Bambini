import { randomUUID } from "node:crypto";
import type {
  CheckoutSession,
  CreateCheckoutRequest,
  PaymentProvider,
  RefundResult,
  WebhookVerificationResult,
} from "../types";

/** Local-dev/test provider — no network calls, no API keys. */
export class MockPaymentProvider implements PaymentProvider {
  readonly slug = "mock";

  async createCheckout(request: CreateCheckoutRequest): Promise<CheckoutSession> {
    const providerReference = randomUUID();
    return {
      providerSlug: this.slug,
      providerReference,
      redirectUrl: `${request.returnUrl}?mock_payment_ref=${providerReference}`,
    };
  }

  async verifyWebhook(
    rawBody: string,
    _signatureHeader: string | null,
  ): Promise<WebhookVerificationResult> {
    try {
      const payload = JSON.parse(rawBody) as {
        providerReference?: string;
        merchantReference?: string;
        status?: string;
        amountCents?: number;
      };
      if (!payload.providerReference || !payload.merchantReference || !payload.status) {
        return { valid: false, reason: "missing required field" };
      }
      if (!["paid", "failed", "refunded"].includes(payload.status)) {
        return { valid: false, reason: "unrecognized status" };
      }
      if (typeof payload.amountCents !== "number" || !Number.isInteger(payload.amountCents)) {
        return { valid: false, reason: "missing/invalid amountCents" };
      }
      return {
        valid: true,
        providerReference: payload.providerReference,
        merchantReference: payload.merchantReference,
        status: payload.status as "paid" | "failed" | "refunded",
        amountCents: payload.amountCents,
      };
    } catch {
      return { valid: false, reason: "malformed JSON body" };
    }
  }

  async refund(providerReference: string, _amountCents: number): Promise<RefundResult> {
    return { providerReference, status: "refunded" };
  }
}
