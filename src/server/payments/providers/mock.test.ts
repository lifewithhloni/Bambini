import { describe, expect, it } from "vitest";
import { MockPaymentProvider } from "./mock";

describe("MockPaymentProvider", () => {
  const provider = new MockPaymentProvider();

  it("createCheckout returns a plain GET-redirect session (no formFields) with a fresh provider reference", async () => {
    const session = await provider.createCheckout({
      orderId: "order-1",
      amountCents: 5000,
      currency: "ZAR",
      returnUrl: "https://example.com/return",
    });
    expect(session.providerSlug).toBe("mock");
    expect(session.providerReference).toBeTruthy();
    expect(session.redirectUrl).toContain("https://example.com/return");
    expect(session.formFields).toBeUndefined();
  });

  it("verifyWebhook accepts a well-formed payload", async () => {
    const result = await provider.verifyWebhook(
      JSON.stringify({ providerReference: "ref-1", merchantReference: "order-1", status: "paid", amountCents: 5000 }),
      null,
    );
    expect(result).toEqual({
      valid: true,
      providerReference: "ref-1",
      merchantReference: "order-1",
      status: "paid",
      amountCents: 5000,
    });
  });

  it("verifyWebhook rejects a payload missing a required field", async () => {
    const result = await provider.verifyWebhook(JSON.stringify({ providerReference: "ref-1", status: "paid" }), null);
    expect(result.valid).toBe(false);
  });

  it("verifyWebhook rejects an unrecognized status", async () => {
    const result = await provider.verifyWebhook(
      JSON.stringify({ providerReference: "ref-1", merchantReference: "order-1", status: "bogus", amountCents: 5000 }),
      null,
    );
    expect(result.valid).toBe(false);
  });

  it("verifyWebhook rejects malformed JSON without throwing", async () => {
    const result = await provider.verifyWebhook("not json", null);
    expect(result.valid).toBe(false);
  });
});
