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
      const payload = JSON.parse(rawBody) as { providerReference?: string; status?: string };
      if (!payload.providerReference || !payload.status) return { valid: false };
      if (!["paid", "failed", "refunded"].includes(payload.status)) return { valid: false };
      return {
        valid: true,
        providerReference: payload.providerReference,
        status: payload.status as "paid" | "failed" | "refunded",
      };
    } catch {
      return { valid: false };
    }
  }

  async refund(providerReference: string, _amountCents: number): Promise<RefundResult> {
    return { providerReference, status: "refunded" };
  }
}
