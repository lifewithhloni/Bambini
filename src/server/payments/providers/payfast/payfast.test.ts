import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

let mockEnv: Record<string, string | undefined>;
vi.mock("@/config/env", () => ({
  getServerEnv: () => mockEnv,
}));

const { PayFastProvider, isValidPayFastSenderHost } = await import("./payfast");
const { generatePayFastSignature, buildPayFastParamString } = await import("./signature");

const SANDBOX_ENV = {
  PAYFAST_MERCHANT_ID: "10000100",
  PAYFAST_MERCHANT_KEY: "46f0cd694581a",
  PAYFAST_PASSPHRASE: "jt7NOE43FZPn",
  PAYFAST_SANDBOX: undefined, // default -> sandbox
};

beforeEach(() => {
  mockEnv = { ...SANDBOX_ENV };
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PayFastProvider.createCheckout", () => {
  it("builds a form-POST checkout session pointed at the sandbox process URL by default", async () => {
    const provider = new PayFastProvider();
    const session = await provider.createCheckout({
      orderId: "11111111-1111-4111-8111-111111111111",
      amountCents: 49999,
      currency: "ZAR",
      returnUrl: "https://bambini.example/orders/xyz/return",
      cancelUrl: "https://bambini.example/orders/xyz/pay?cancelled=1",
      notifyUrl: "https://bambini.example/api/payments/payfast/webhook",
      itemName: "Baby Stroller",
    });

    expect(session.providerSlug).toBe("payfast");
    expect(session.redirectUrl).toBe("https://sandbox.payfast.co.za/eng/process");
    expect(session.formFields).toBeDefined();
  });

  it("never sends the raw integer cents value to PayFast — only the converted decimal string", async () => {
    const provider = new PayFastProvider();
    const session = await provider.createCheckout({
      orderId: "order-1",
      amountCents: 49999,
      currency: "ZAR",
      returnUrl: "https://bambini.example/return",
    });
    expect(session.formFields?.amount).toBe("499.99");
  });

  it("includes a signature field computed over the actual form fields", async () => {
    const provider = new PayFastProvider();
    const session = await provider.createCheckout({
      orderId: "order-1",
      amountCents: 10000,
      currency: "ZAR",
      returnUrl: "https://bambini.example/return",
    });
    expect(session.formFields?.signature).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses the live process URL when PAYFAST_SANDBOX=false", async () => {
    mockEnv.PAYFAST_SANDBOX = "false";
    const provider = new PayFastProvider();
    const session = await provider.createCheckout({
      orderId: "order-1",
      amountCents: 10000,
      currency: "ZAR",
      returnUrl: "https://bambini.example/return",
    });
    expect(session.redirectUrl).toBe("https://www.payfast.co.za/eng/process");
  });

  it("throws a clear error (never silently proceeds) when PayFast credentials are missing", async () => {
    mockEnv.PAYFAST_MERCHANT_ID = undefined;
    const provider = new PayFastProvider();
    await expect(
      provider.createCheckout({ orderId: "order-1", amountCents: 10000, currency: "ZAR", returnUrl: "https://x.example" }),
    ).rejects.toThrow(/PAYFAST_MERCHANT_ID/);
  });

  it("omits blank optional fields (cancel_url/notify_url) from the form rather than sending them empty", async () => {
    const provider = new PayFastProvider();
    const session = await provider.createCheckout({
      orderId: "order-1",
      amountCents: 10000,
      currency: "ZAR",
      returnUrl: "https://bambini.example/return",
    });
    expect(session.formFields).not.toHaveProperty("cancel_url");
    expect(session.formFields).not.toHaveProperty("notify_url");
  });
});

describe("PayFastProvider.verifyWebhook", () => {
  function buildValidItn(overrides: Partial<Record<string, string>> = {}) {
    const fields: [string, string][] = [
      ["m_payment_id", overrides.m_payment_id ?? "order-1"],
      ["pf_payment_id", overrides.pf_payment_id ?? "1089250"],
      ["payment_status", overrides.payment_status ?? "COMPLETE"],
      ["amount_gross", overrides.amount_gross ?? "499.99"],
      ["merchant_id", overrides.merchant_id ?? "10000100"],
    ];
    const signature = generatePayFastSignature(fields, SANDBOX_ENV.PAYFAST_PASSPHRASE);
    const body = buildPayFastParamString([...fields, ["signature", signature]]);
    return body;
  }

  it("accepts a well-formed, correctly-signed COMPLETE event once PayFast validation confirms it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("VALID", { status: 200 })),
    );
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(buildValidItn(), null);
    expect(result).toEqual({
      valid: true,
      providerReference: "1089250",
      merchantReference: "order-1",
      status: "paid",
      amountCents: 49999,
    });
  });

  it("maps CANCELLED to failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("VALID", { status: 200 })),
    );
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(buildValidItn({ payment_status: "CANCELLED" }), null);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.status).toBe("failed");
  });

  it("rejects an unrecognized payment_status rather than guessing a mapping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("VALID", { status: 200 })),
    );
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(buildValidItn({ payment_status: "DECLINED" }), null);
    expect(result.valid).toBe(false);
  });

  it("rejects a request with an invalid signature, without ever calling PayFast to validate", async () => {
    const fetchMock = vi.fn(async () => new Response("VALID", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new PayFastProvider();
    const tampered = buildValidItn().replace("499.99", "1.00"); // invalidates the signature
    const result = await provider.verifyWebhook(tampered, null);
    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature field at all", async () => {
    const provider = new PayFastProvider();
    const bodyWithoutSignature = "m_payment_id=order-1&pf_payment_id=123&payment_status=COMPLETE&amount_gross=100.00";
    const result = await provider.verifyWebhook(bodyWithoutSignature, null);
    expect(result.valid).toBe(false);
  });

  it("rejects when PayFast's own server validation does not return VALID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("INVALID", { status: 200 })),
    );
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(buildValidItn(), null);
    expect(result.valid).toBe(false);
  });

  it("fails closed (rejects) when the PayFast validation request itself fails (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(buildValidItn(), null);
    expect(result.valid).toBe(false);
  });

  it("rejects a missing required field (e.g. no pf_payment_id)", async () => {
    const fields: [string, string][] = [
      ["m_payment_id", "order-1"],
      ["payment_status", "COMPLETE"],
      ["amount_gross", "100.00"],
    ];
    const signature = generatePayFastSignature(fields, SANDBOX_ENV.PAYFAST_PASSPHRASE);
    const body = buildPayFastParamString([...fields, ["signature", signature]]);
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(body, null);
    expect(result.valid).toBe(false);
  });

  it("rejects an unparseable amount_gross", async () => {
    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(buildValidItn({ amount_gross: "not-a-number" }), null);
    expect(result.valid).toBe(false);
  });

  it("posts the parameter string (excluding signature) to the validate endpoint, matching the documented request shape", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("VALID", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new PayFastProvider();
    await provider.verifyWebhook(buildValidItn(), null);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.payfast.co.za/eng/query/validate",
      expect.objectContaining({ method: "POST" }),
    );
    const options = fetchMock.mock.calls[0][1];
    expect(options?.body).not.toContain("signature=");
  });
});

describe("isValidPayFastSenderHost", () => {
  it("accepts the documented sandbox hostname", () => {
    expect(isValidPayFastSenderHost("https://sandbox.payfast.co.za/some/path")).toBe(true);
  });

  it("rejects an unrelated/spoofed hostname", () => {
    expect(isValidPayFastSenderHost("https://evil.example.com/sandbox.payfast.co.za")).toBe(false);
  });

  it("rejects a null/missing referer", () => {
    expect(isValidPayFastSenderHost(null)).toBe(false);
  });

  it("rejects a malformed URL rather than throwing", () => {
    expect(isValidPayFastSenderHost("not a url")).toBe(false);
  });

  it("rejects the live hostnames while in sandbox mode", () => {
    expect(isValidPayFastSenderHost("https://www.payfast.co.za/notify")).toBe(false);
  });
});
