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

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

const { createOrder } = await import("./actions");

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

  it("calls create_order with only the product id and fulfilment type — no price, seller, buyer, or commission field", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_reference: "BMB-ABC123" }], error: null });

    await expect(createOrder("product-1", null, formData({ fulfilmentType: "collection" }))).rejects.toThrow(RedirectSignal);

    expect(rpcMock).toHaveBeenCalledWith("create_order", {
      p_product_id: "product-1",
      p_fulfilment_type: "collection",
    });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_fulfilment_type", "p_product_id"]);
  });

  it("redirects to the new order's own detail page on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-42", order_reference: "BMB-XYZ789" }], error: null });

    await expect(createOrder("product-1", null, formData({ fulfilmentType: "delivery" }))).rejects.toThrow(RedirectSignal);

    expect(redirectMock).toHaveBeenCalledWith("/account/orders/order-42");
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
