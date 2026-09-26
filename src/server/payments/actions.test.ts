import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

vi.mock("@/config/env", () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://bambini.example" }),
}));

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeSupabaseMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const fromCalls: string[] = [];
  const rpcMock = vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
    data: null,
    error: null,
  }));

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const next = queues[table]?.shift() ?? { data: null, error: null };
      return makeChain(next);
    }),
    rpc: rpcMock,
  };

  return { client, queue, fromCalls, rpcMock };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

const createCheckoutMock = vi.fn();
vi.mock("./registry", () => ({
  getActivePaymentProvider: () => ({ slug: "mock", createCheckout: createCheckoutMock }),
}));

const { initiatePayment } = await import("./actions");

const pendingOrder = {
  id: "order-1",
  buyer_id: "buyer-1",
  status: "pending_payment",
  total_cents: 50000,
  currency: "ZAR",
  order_reference: "BMB-AAA111",
};

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "buyer-1", email: "buyer@example.com" });
  mockSupabase = makeSupabaseMock();
  createCheckoutMock.mockReset();
  createCheckoutMock.mockResolvedValue({
    providerSlug: "mock",
    providerReference: "order-1",
    redirectUrl: "https://mock.example/pay",
  });
});

describe("initiatePayment", () => {
  it("requires authentication before doing anything else — an unauthenticated caller never reaches the order/payment lookup", async () => {
    class RedirectSignal extends Error {}
    requireUserMock.mockImplementation(() => {
      throw new RedirectSignal("/login");
    });
    await expect(initiatePayment("order-1")).rejects.toThrow(RedirectSignal);
    expect(mockSupabase.client.from).not.toHaveBeenCalled();
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns an error when the order doesn't exist / doesn't belong to the caller, never leaking which case it was", async () => {
    mockSupabase.queue("orders", { data: null, error: null });
    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: "Order not found." });
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns an error when the order belongs to a different buyer, without calling the provider", async () => {
    mockSupabase.queue("orders", { data: { ...pendingOrder, buyer_id: "someone-else" }, error: null });
    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: "Order not found." });
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns an error when the order is not pending_payment", async () => {
    mockSupabase.queue("orders", { data: { ...pendingOrder, status: "confirmed" }, error: null });
    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: "This order is not payable." });
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns an error when the payment is already paid", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "paid", method: "online" }, error: null });
    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: "This order has already been paid." });
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("refuses to initiate a PayFast payment for a cash order — a cash order also starts out pending_payment, same as online, before the seller accepts it", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "pending", method: "cash" }, error: null });
    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: expect.stringMatching(/cash/i) });
    expect(createCheckoutMock).not.toHaveBeenCalled();
    expect(mockSupabase.rpcMock).not.toHaveBeenCalled();
  });

  it("calls the provider with the order's own authoritative amount/currency — never anything client-supplied (there is no client input to this action at all beyond the order id)", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "pending", method: "online" }, error: null });
    mockSupabase.queue("order_items", { data: { title_snapshot: "Stroller" }, error: null });

    await initiatePayment("order-1");

    expect(createCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        amountCents: 50000,
        currency: "ZAR",
      }),
    );
  });

  it("builds return/cancel/notify URLs from the server's own site URL, never from client input", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "pending", method: "online" }, error: null });
    mockSupabase.queue("order_items", { data: { title_snapshot: "Stroller" }, error: null });

    await initiatePayment("order-1");

    const args = createCheckoutMock.mock.calls[0][0];
    expect(args.returnUrl).toBe("https://bambini.example/orders/order-1/return");
    expect(args.cancelUrl).toBe("https://bambini.example/orders/order-1/pay?cancelled=1");
    expect(args.notifyUrl).toBe("https://bambini.example/api/payments/payfast/webhook");
  });

  it("persists the provider reference via record_payment_attempt and returns the checkout session on success", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "pending", method: "online" }, error: null });
    mockSupabase.queue("order_items", { data: { title_snapshot: "Stroller" }, error: null });

    const result = await initiatePayment("order-1");

    expect(mockSupabase.rpcMock).toHaveBeenCalledWith("record_payment_attempt", {
      p_order_id: "order-1",
      p_provider_reference: "order-1",
    });
    expect(result).toEqual({
      session: { providerSlug: "mock", providerReference: "order-1", redirectUrl: "https://mock.example/pay" },
    });
  });

  it("returns a safe, generic error if record_payment_attempt fails, never a raw DB error", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "pending", method: "online" }, error: null });
    mockSupabase.queue("order_items", { data: { title_snapshot: "Stroller" }, error: null });
    mockSupabase.rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });

    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/permission denied/i);
  });

  it("returns a safe error, mentioning the order reference not raw internals, if the provider itself throws", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "pending", method: "online" }, error: null });
    mockSupabase.queue("order_items", { data: { title_snapshot: "Stroller" }, error: null });
    createCheckoutMock.mockRejectedValueOnce(new Error("PAYFAST_MERCHANT_ID is not set"));

    const result = await initiatePayment("order-1");
    expect(result).toEqual({ error: expect.stringContaining("BMB-AAA111") });
    expect((result as { error: string }).error).not.toMatch(/PAYFAST_MERCHANT_ID/);
  });

  it("allows re-initiation for a previously failed payment (retry)", async () => {
    mockSupabase.queue("orders", { data: pendingOrder, error: null });
    mockSupabase.queue("payments", { data: { id: "payment-1", status: "failed", method: "online" }, error: null });
    mockSupabase.queue("order_items", { data: { title_snapshot: "Stroller" }, error: null });

    const result = await initiatePayment("order-1");
    expect(createCheckoutMock).toHaveBeenCalled();
    expect(result).toHaveProperty("session");
  });
});
