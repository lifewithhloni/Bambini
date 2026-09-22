import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyWebhookMock = vi.fn();
const isValidPayFastSenderHostMock = vi.fn();
vi.mock("@/server/payments/providers/payfast/payfast", () => ({
  // A regular `function`, not an arrow function, so `new PayFastProvider()`
  // in the route handler works — arrow functions can't be constructors.
  PayFastProvider: vi.fn().mockImplementation(function PayFastProviderMock(this: { verifyWebhook: typeof verifyWebhookMock }) {
    this.verifyWebhook = verifyWebhookMock;
  }),
  isValidPayFastSenderHost: isValidPayFastSenderHostMock,
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
}));

const bookDeliveryForOrderMock = vi.fn();
vi.mock("@/server/delivery/bookingService", () => ({
  bookDeliveryForOrder: bookDeliveryForOrderMock,
}));

const { POST } = await import("./route");

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://bambini.example/api/payments/payfast/webhook", {
    method: "POST",
    body,
    headers: { referer: "https://sandbox.payfast.co.za/eng/process", ...headers },
  });
}

const validResult = {
  valid: true as const,
  providerReference: "pf-123",
  merchantReference: "11111111-1111-4111-8111-111111111111",
  status: "paid" as const,
  amountCents: 50000,
};

beforeEach(() => {
  verifyWebhookMock.mockReset();
  isValidPayFastSenderHostMock.mockReset();
  rpcMock.mockReset();
  bookDeliveryForOrderMock.mockReset();
  bookDeliveryForOrderMock.mockResolvedValue(undefined);
  isValidPayFastSenderHostMock.mockReturnValue(true);
});

describe("POST /api/payments/payfast/webhook", () => {
  it("rejects (400) when the adapter's own verification fails, without ever calling the database", async () => {
    verifyWebhookMock.mockResolvedValue({ valid: false, reason: "signature mismatch" });
    const response = await POST(makeRequest("bogus=1"));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects (400) when the sender host check fails, even if the signature/validate check passed", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    isValidPayFastSenderHostMock.mockReturnValue(false);
    const response = await POST(makeRequest("...", { referer: "https://evil.example.com" }));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects (400) when the merchant reference isn't a recognizable order id", async () => {
    verifyWebhookMock.mockResolvedValue({ ...validResult, merchantReference: "not-a-uuid" });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls process_payfast_itn with exactly the adapter's verified fields, via the admin/service-role client", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: [{ outcome: "confirmed" }], error: null });

    await POST(makeRequest("..."));

    expect(rpcMock).toHaveBeenCalledWith("process_payfast_itn", {
      p_order_id: "11111111-1111-4111-8111-111111111111",
      p_provider_reference: "pf-123",
      p_status: "paid",
      p_amount_cents: 50000,
    });
  });

  it("returns 200 for a 'confirmed' outcome", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: [{ outcome: "confirmed" }], error: null });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(200);
  });

  it("returns 200 for a 'duplicate_ignored' outcome — PayFast should not keep retrying a safely-processed duplicate", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: [{ outcome: "duplicate_ignored" }], error: null });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(200);
  });

  it("returns 200 for a 'failed_recorded' outcome — this is a successfully-processed CANCELLED event, not an error", async () => {
    verifyWebhookMock.mockResolvedValue({ ...validResult, status: "failed" });
    rpcMock.mockResolvedValue({ data: [{ outcome: "failed_recorded" }], error: null });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(200);
  });

  it("returns 400 (not 200) for a 'rejected_amount_mismatch' outcome from the database function", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: [{ outcome: "rejected_amount_mismatch" }], error: null });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a 'rejected_not_found' outcome", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: [{ outcome: "rejected_not_found" }], error: null });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(400);
  });

  it("returns 500 (not a false 200) if the RPC call itself errors", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(500);
  });

  it("never leaks raw error internals in the JSON response body", async () => {
    verifyWebhookMock.mockResolvedValue(validResult);
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied for table payments" } });
    const response = await POST(makeRequest("..."));
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/permission denied/i);
  });

  it("returns a clean 500 (never an unhandled crash/stack trace) if the adapter itself throws — e.g. PayFast not configured", async () => {
    verifyWebhookMock.mockRejectedValue(new Error("PAYFAST_MERCHANT_ID is not set"));
    const response = await POST(makeRequest("..."));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/PAYFAST_MERCHANT_ID/);
  });

  describe("Phase 7A: delivery booking trigger", () => {
    it("16. books delivery after a 'confirmed' outcome", async () => {
      verifyWebhookMock.mockResolvedValue(validResult);
      rpcMock.mockResolvedValue({ data: [{ outcome: "confirmed" }], error: null });
      await POST(makeRequest("..."));
      expect(bookDeliveryForOrderMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    });

    it("17. also attempts booking on a 'duplicate_ignored' outcome — the retry safety net for a crash between reservation and booking", async () => {
      verifyWebhookMock.mockResolvedValue(validResult);
      rpcMock.mockResolvedValue({ data: [{ outcome: "duplicate_ignored" }], error: null });
      await POST(makeRequest("..."));
      expect(bookDeliveryForOrderMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    });

    it("never attempts booking for a 'failed_recorded' outcome — nothing was paid", async () => {
      verifyWebhookMock.mockResolvedValue({ ...validResult, status: "failed" });
      rpcMock.mockResolvedValue({ data: [{ outcome: "failed_recorded" }], error: null });
      await POST(makeRequest("..."));
      expect(bookDeliveryForOrderMock).not.toHaveBeenCalled();
    });

    it("never attempts booking for a rejected outcome", async () => {
      verifyWebhookMock.mockResolvedValue(validResult);
      rpcMock.mockResolvedValue({ data: [{ outcome: "rejected_amount_mismatch" }], error: null });
      await POST(makeRequest("..."));
      expect(bookDeliveryForOrderMock).not.toHaveBeenCalled();
    });

    it("still returns 200 for a 'confirmed' outcome even if booking itself throws — a booking problem is never surfaced as a payment processing failure to PayFast", async () => {
      verifyWebhookMock.mockResolvedValue(validResult);
      rpcMock.mockResolvedValue({ data: [{ outcome: "confirmed" }], error: null });
      bookDeliveryForOrderMock.mockRejectedValue(new Error("provider unreachable"));
      const response = await POST(makeRequest("..."));
      expect(response.status).toBe(200);
    });
  });
});
