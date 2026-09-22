import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

class RedirectSignal extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}
const redirectMock = vi.fn((target: string) => {
  throw new RedirectSignal(target);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

const { createOrder, acceptCashOrder, declineCashOrder, confirmCollection, cancelPendingDeliveryOrder } = await import("./actions");

function formData(fields: Record<string, string | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "buyer-1", email: "buyer@example.com" });
  redirectMock.mockClear();
  revalidatePathMock.mockClear();
  rpcMock.mockReset();
});

describe("createOrder", () => {
  it("rejects an invalid/missing fulfilment type before ever touching the database", async () => {
    const result = await createOrder("product-1", null, formData({}));
    expect(result).toEqual({ error: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized fulfilment value (never passed through to the RPC as arbitrary text)", async () => {
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "teleport" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls create_order with only the product id, fulfilment type, payment method, and delivery quote id — no price, seller, buyer, or commission field", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_reference: "BMB-ABC123" }], error: null });

    await expect(createOrder("product-1", null, formData({ fulfilmentType: "collection" }))).rejects.toThrow(RedirectSignal);

    expect(rpcMock).toHaveBeenCalledWith("create_order", {
      p_product_id: "product-1",
      p_fulfilment_type: "collection",
      p_payment_method: "online",
      p_delivery_quote_id: null,
    });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_delivery_quote_id", "p_fulfilment_type", "p_payment_method", "p_product_id"]);
  });

  it("Phase 7A: rejects a delivery submission with no delivery quote id, before ever calling the database", async () => {
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "delivery" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("Phase 7A: rejects a delivery submission with a malformed (non-uuid) delivery quote id", async () => {
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "delivery", deliveryQuoteId: "not-a-uuid" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("defaults to 'online' when no paymentMethod field is present at all, and passes the selected delivery quote id through", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_reference: "BMB-ABC123" }], error: null });
    await expect(
      createOrder(
        "product-1",
        null,
        formData({ fulfilmentType: "delivery", deliveryQuoteId: "11111111-1111-4111-8111-111111111111" }),
      ),
    ).rejects.toThrow(RedirectSignal);
    expect(rpcMock).toHaveBeenCalledWith("create_order", {
      p_product_id: "product-1",
      p_fulfilment_type: "delivery",
      p_payment_method: "online",
      p_delivery_quote_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects an unrecognized payment method value (never passed through to the RPC as arbitrary text)", async () => {
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "collection", paymentMethod: "bitcoin" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes 'cash' through when the buyer selects it", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-9", order_reference: "BMB-CASH01" }], error: null });
    await expect(createOrder("product-1", null, formData({ fulfilmentType: "collection", paymentMethod: "cash" }))).rejects.toThrow(RedirectSignal);
    expect(rpcMock).toHaveBeenCalledWith("create_order", {
      p_product_id: "product-1",
      p_fulfilment_type: "collection",
      p_payment_method: "cash",
      p_delivery_quote_id: null,
    });
  });

  it("redirects to the new order's payment step on success for online orders (Phase 4B: an order isn't done until it's paid — see actions.ts)", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-42", order_reference: "BMB-XYZ789" }], error: null });

    await expect(
      createOrder(
        "product-1",
        null,
        formData({ fulfilmentType: "delivery", deliveryQuoteId: "11111111-1111-4111-8111-111111111111" }),
      ),
    ).rejects.toThrow(RedirectSignal);

    expect(redirectMock).toHaveBeenCalledWith("/orders/order-42/pay");
  });

  it("redirects straight to the order details page for cash orders — there's no PayFast checkout to send the buyer to", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-43", order_reference: "BMB-CASH02" }], error: null });

    await expect(
      createOrder("product-1", null, formData({ fulfilmentType: "collection", paymentMethod: "cash" })),
    ).rejects.toThrow(RedirectSignal);

    expect(redirectMock).toHaveBeenCalledWith("/account/orders/order-43");
  });

  it("requires authentication before doing anything else", async () => {
    requireUserMock.mockImplementation(() => {
      throw new RedirectSignal("/login");
    });
    await expect(createOrder("product-1", null, formData({ fulfilmentType: "collection" }))).rejects.toThrow(RedirectSignal);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces a friendly message for 'not available', never the raw Postgres error text", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Product is not available for purchase" } });
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "collection" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/Product is not available for purchase/);
  });

  it("surfaces a friendly message for buying your own listing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Cannot buy your own listing" } });
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "collection" }));
    expect(result).toEqual({ error: expect.stringMatching(/own listing/i) });
  });

  it("returns a generic error (never throws unhandled) on an unrecognized failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "collection" }));
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("returns a generic error if the RPC succeeds with no rows (defensive — should never happen)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await createOrder("product-1", null, formData({ fulfilmentType: "collection" }));
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("acceptCashOrder", () => {
  it("calls accept_cash_order with only the order id", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const result = await acceptCashOrder("order-1", null);
    expect(rpcMock).toHaveBeenCalledWith("accept_cash_order", { p_order_id: "order-1" });
    expect(result).toBeNull();
  });

  it("requires authentication", async () => {
    requireUserMock.mockImplementation(() => {
      throw new RedirectSignal("/login");
    });
    await expect(acceptCashOrder("order-1", null)).rejects.toThrow(RedirectSignal);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces a friendly error, never the raw Postgres message", async () => {
    rpcMock.mockResolvedValue({ error: { message: "You are no longer eligible to accept cash orders" } });
    const result = await acceptCashOrder("order-1", null);
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/You are no longer eligible/);
  });
});

describe("declineCashOrder", () => {
  it("calls decline_cash_order with only the order id", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const result = await declineCashOrder("order-1", null);
    expect(rpcMock).toHaveBeenCalledWith("decline_cash_order", { p_order_id: "order-1" });
    expect(result).toBeNull();
  });
});

describe("confirmCollection", () => {
  it("rejects a malformed code before ever calling the database", async () => {
    const result = await confirmCollection("order-1", null, formData({ code: "abc" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends only the order id and the entered code — never the true stored code (it never has it)", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "completed" }], error: null });
    await confirmCollection("order-1", null, formData({ code: "123456" }));
    expect(rpcMock).toHaveBeenCalledWith("confirm_collection", { p_order_id: "order-1", p_code: "123456" });
  });

  it("reports success for a 'completed' outcome", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "completed" }], error: null });
    const result = await confirmCollection("order-1", null, formData({ code: "123456" }));
    expect(result).toEqual({ success: true, outcome: "completed" });
  });

  it("reports success for an idempotent 'already_completed' outcome", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "already_completed" }], error: null });
    const result = await confirmCollection("order-1", null, formData({ code: "123456" }));
    expect(result).toEqual({ success: true, outcome: "already_completed" });
  });

  it("reports a clear (but non-throwing) error for an incorrect code", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "incorrect_code" }], error: null });
    const result = await confirmCollection("order-1", null, formData({ code: "000000" }));
    expect(result).toEqual({ error: expect.any(String), outcome: "incorrect_code" });
  });

  it("reports lockout distinctly from a plain incorrect code", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "locked" }], error: null });
    const result = await confirmCollection("order-1", null, formData({ code: "000000" }));
    expect(result).toEqual({ error: expect.stringMatching(/locked/i), outcome: "locked" });
  });
});

describe("cancelPendingDeliveryOrder", () => {
  it("calls cancel_pending_delivery_order with only the order id", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await expect(cancelPendingDeliveryOrder("order-1", null)).rejects.toThrow(RedirectSignal);
    expect(rpcMock).toHaveBeenCalledWith("cancel_pending_delivery_order", { p_order_id: "order-1" });
  });

  it("requires authentication before doing anything else", async () => {
    requireUserMock.mockImplementation(() => {
      throw new RedirectSignal("/login");
    });
    await expect(cancelPendingDeliveryOrder("order-1", null)).rejects.toThrow(RedirectSignal);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("redirects to the order details page on success", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await expect(cancelPendingDeliveryOrder("order-1", null)).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/account/orders/order-1");
  });

  it("surfaces a friendly error, never the raw Postgres message, when the order can no longer be cancelled", async () => {
    rpcMock.mockResolvedValue({ error: { message: "Order cannot be cancelled at this stage" } });
    const result = await cancelPendingDeliveryOrder("order-1", null);
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/cannot be cancelled at this stage/i);
  });

  it("surfaces a friendly error for a nonexistent/not-owned order, never confirming which", async () => {
    rpcMock.mockResolvedValue({ error: { message: "Order not found" } });
    const result = await cancelPendingDeliveryOrder("order-1", null);
    expect(result).toEqual({ error: expect.any(String) });
  });
});
