import type {
  CheckoutSession,
  CreateCheckoutRequest,
  PaymentProvider,
  RefundResult,
  WebhookVerificationResult,
} from "../../types";
import { centsToDecimalString, decimalStringToCents } from "../../money";
import { getPayFastCredentials, getPayFastHosts } from "./config";
import { buildPayFastParamString, generatePayFastSignature, verifyPayFastSignature } from "./signature";

/**
 * PayFast's documented ITN only ever sends `COMPLETE` (successful
 * payment) or `CANCELLED` (a cancelled subscription — the closest
 * documented equivalent to "this payment did not succeed" for a
 * once-off payment). There is no third, documented "declined"/"failed"
 * status — inventing one would violate "do not invent payment status
 * names." Anything else is treated as unrecognized and rejected, not
 * guessed at.
 */
function mapPayFastStatus(rawStatus: string): "paid" | "failed" | null {
  if (rawStatus === "COMPLETE") return "paid";
  if (rawStatus === "CANCELLED") return "failed";
  return null;
}

/**
 * PayFast's documented ITN validation posts the same parameter string
 * used for the signature check (all fields except `signature`, in
 * original order, url-encoded) back to their `/eng/query/validate`
 * endpoint and requires the literal response body `VALID`. A network
 * failure or any other response is treated as "not verified" — fail
 * closed, never assume success when we can't confirm it.
 */
async function confirmWithPayFast(paramString: string, validateUrl: string): Promise<boolean> {
  try {
    const response = await fetch(validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: paramString,
    });
    if (!response.ok) return false;
    const text = await response.text();
    return text.trim() === "VALID";
  } catch {
    return false;
  }
}

/**
 * PayFast's own documented check is referer/hostname-based (their
 * sample code resolves a fixed list of PayFast hostnames to IPs and
 * compares against the request's HTTP_REFERER) — not a cryptographic
 * check, and a header value in principle. This is intentionally the
 * weakest of the checks performed; signature verification and the
 * query/validate server confirmation are what this integration
 * actually relies on for authenticity. Exported separately (rather
 * than folded into verifyWebhook()) because it needs the incoming
 * request's own headers, which the shared PaymentProvider interface's
 * verifyWebhook(rawBody, signatureHeader) signature has no way to
 * carry without changing that interface for every provider.
 */
export function isValidPayFastSenderHost(refererOrOrigin: string | null): boolean {
  if (!refererOrOrigin) return false;
  try {
    const hostname = new URL(refererOrOrigin).hostname.toLowerCase();
    return getPayFastHosts().validSenderHosts.includes(hostname);
  } catch {
    return false;
  }
}

export class PayFastProvider implements PaymentProvider {
  readonly slug = "payfast";

  /**
   * PayFast's "Custom Integration" model (the one documented at
   * developers.payfast.co.za/docs) is a browser form POST to
   * /eng/process, not a server-to-server "create a session" API call —
   * there is no PayFast-issued reference to receive at this point, only
   * after the ITN arrives with pf_payment_id. providerReference here is
   * therefore Bambini's own merchant reference (the order id, which is
   * also sent as m_payment_id) — a deliberate placeholder until the
   * real PayFast id exists, not a PayFast-issued value. See
   * DECISIONS.md.
   */
  async createCheckout(request: CreateCheckoutRequest): Promise<CheckoutSession> {
    const { merchantId, merchantKey, passphrase } = getPayFastCredentials();
    const { processUrl } = getPayFastHosts();

    const amount = centsToDecimalString(request.amountCents);

    // Field order matches PayFast's own documented attribute list
    // (merchant details, then transaction details) — the outbound
    // signature must be computed over this exact order; see
    // signature.ts for why it can never be alphabetized.
    const fields: [string, string | undefined][] = [
      ["merchant_id", merchantId],
      ["merchant_key", merchantKey],
      ["return_url", request.returnUrl],
      ["cancel_url", request.cancelUrl],
      ["notify_url", request.notifyUrl],
      ["m_payment_id", request.orderId],
      ["amount", amount],
      ["item_name", request.itemName ?? "Bambini order"],
    ];

    const signature = generatePayFastSignature(fields, passphrase);

    const formFields: Record<string, string> = {};
    for (const [key, value] of fields) {
      if (value !== undefined && value !== "") formFields[key] = value;
    }
    formFields.signature = signature;

    return {
      providerSlug: this.slug,
      providerReference: request.orderId,
      redirectUrl: processUrl,
      formFields,
    };
  }

  /**
   * Deliberately does NOT perform the host/referer check (see
   * isValidPayFastSenderHost() above) — that needs the raw incoming
   * request, which this method doesn't receive. The webhook route
   * handler calls both this method and isValidPayFastSenderHost()
   * and requires both (plus the route's own amount-vs-order-total
   * check) before treating an event as authentic.
   */
  async verifyWebhook(rawBody: string, _signatureHeader: string | null): Promise<WebhookVerificationResult> {
    const { passphrase } = getPayFastCredentials();
    const { validateUrl } = getPayFastHosts();

    // URLSearchParams preserves the field order the body was actually
    // sent in — required for both the signature check and the
    // query/validate call, which must reconstruct PayFast's own
    // parameter string exactly, not a re-ordered/re-serialized one.
    const params = new URLSearchParams(rawBody);
    const postedFields: [string, string][] = [...params.entries()];

    const receivedSignature = params.get("signature");
    if (!receivedSignature) {
      return { valid: false, reason: "missing signature field" };
    }

    if (!verifyPayFastSignature(postedFields, receivedSignature, passphrase)) {
      return { valid: false, reason: "signature mismatch" };
    }

    const merchantReference = params.get("m_payment_id");
    const providerReference = params.get("pf_payment_id");
    const rawStatus = params.get("payment_status");
    const amountGrossRaw = params.get("amount_gross");

    if (!merchantReference || !providerReference || !rawStatus || !amountGrossRaw) {
      return { valid: false, reason: "missing a required ITN field" };
    }

    const status = mapPayFastStatus(rawStatus);
    if (!status) {
      return { valid: false, reason: `unrecognized payment_status value` };
    }

    const amountCents = decimalStringToCents(amountGrossRaw);
    if (amountCents === null) {
      return { valid: false, reason: "unparseable amount_gross" };
    }

    // The same parameter string (all fields but `signature`, in
    // original order) used for the signature check is what PayFast's
    // own docs post back to /eng/query/validate.
    const paramStringWithoutSignature = buildPayFastParamString(
      postedFields.filter(([key]) => key !== "signature"),
    );
    const confirmed = await confirmWithPayFast(paramStringWithoutSignature, validateUrl);
    if (!confirmed) {
      return { valid: false, reason: "PayFast server validation did not return VALID" };
    }

    return { valid: true, providerReference, merchantReference, status, amountCents };
  }

  /**
   * Not implemented this phase — PayFast's ITN model doesn't require a
   * refund path to safely process payment confirmations, and Phase 4B
   * explicitly excludes refunds. Throws rather than silently
   * pretending to succeed.
   */
  async refund(_providerReference: string, _amountCents: number): Promise<RefundResult> {
    throw new Error("PayFast refunds are not implemented in this phase — see DECISIONS.md.");
  }
}
