import { describe, expect, it, vi, beforeEach } from "vitest";

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.or = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeSupabaseMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const fromCalls: string[] = [];
  const chains: Record<string, ReturnType<typeof makeChain>[]> = {};

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const next = queues[table]?.shift() ?? { data: [], error: null };
      const chain = makeChain(next);
      chains[table] ??= [];
      chains[table].push(chain);
      return chain;
    }),
  };

  return { client, queue, fromCalls, chains };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

const { getSellerOrders, getBusinessOrders } = await import("./getSellerOrders");

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
  mockSupabase.queue("businesses", { data: [], error: null });
  mockSupabase.queue("business_members", { data: [], error: null });
});

describe("getSellerOrders", () => {
  it("returns an empty array when the seller has no orders", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    const result = await getSellerOrders("seller-1");
    expect(result).toEqual([]);
  });

  it("filters by seller_profile_id alone when the seller belongs to no business", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    await getSellerOrders("seller-1");
    expect(mockSupabase.chains.orders[0].or).toHaveBeenCalledWith("seller_profile_id.eq.seller-1");
  });

  it("includes owned/member business ids in the filter when the seller has them", async () => {
    mockSupabase = makeSupabaseMock();
    mockSupabase.queue("businesses", { data: [{ id: "biz-1" }], error: null });
    mockSupabase.queue("business_members", { data: [{ business_id: "biz-2" }], error: null });
    mockSupabase.queue("orders", { data: [], error: null });

    await getSellerOrders("seller-1");

    const filter = (mockSupabase.chains.orders[0].or as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(filter).toContain("seller_profile_id.eq.seller-1");
    expect(filter).toContain("biz-1");
    expect(filter).toContain("biz-2");
  });

  it("joins order_items/payments/buyer names and merges them into each summary, exposing only the buyer's public name", async () => {
    mockSupabase.queue("orders", {
      data: [
        {
          id: "order-1",
          order_reference: "BMB-AAA111",
          status: "pending_payment",
          fulfilment_type: "collection",
          total_cents: 5000,
          currency: "ZAR",
          created_at: "2026-01-01T00:00:00Z",
          buyer_id: "buyer-1",
        },
      ],
      error: null,
    });
    mockSupabase.queue("order_items", { data: [{ order_id: "order-1", product_id: "product-1", title_snapshot: "Stroller" }], error: null });
    mockSupabase.queue("payments", { data: [{ order_id: "order-1", status: "pending", method: "online" }], error: null });
    mockSupabase.queue("profiles_public", { data: [{ id: "buyer-1", full_name: "Alice Buyer" }], error: null });
    mockSupabase.queue("disputes", { data: [], error: null });
    mockSupabase.queue("product_images", { data: [{ product_id: "product-1", storage_path: "product-1/a.jpg", sort_order: 0 }], error: null });

    const result = await getSellerOrders("seller-1");

    expect(result).toEqual([
      expect.objectContaining({
        id: "order-1",
        productTitle: "Stroller",
        payment_status: "pending",
        payment_method: "online",
        coverImagePath: "product-1/a.jpg",
        buyerName: "Alice Buyer",
        hasActiveDispute: false,
      }),
    ]);
    expect(mockSupabase.fromCalls).toContain("profiles_public");
  });

  it("hasActiveDispute is true only when an open/under_review dispute exists for that order", async () => {
    mockSupabase.queue("orders", {
      data: [
        {
          id: "order-1",
          order_reference: "BMB-AAA111",
          status: "confirmed",
          fulfilment_type: "collection",
          total_cents: 5000,
          currency: "ZAR",
          created_at: "2026-01-01T00:00:00Z",
          buyer_id: "buyer-1",
        },
      ],
      error: null,
    });
    mockSupabase.queue("order_items", { data: [], error: null });
    mockSupabase.queue("payments", { data: [], error: null });
    mockSupabase.queue("profiles_public", { data: [], error: null });
    mockSupabase.queue("disputes", { data: [{ order_id: "order-1", status: "open" }], error: null });

    const result = await getSellerOrders("seller-1");

    expect(result[0].hasActiveDispute).toBe(true);
  });

  it("defaults payment_method to 'online' and coverImagePath to null when nothing joins", async () => {
    mockSupabase.queue("orders", {
      data: [
        {
          id: "order-2",
          order_reference: "BMB-BBB222",
          status: "pending_payment",
          fulfilment_type: "delivery",
          total_cents: 2000,
          currency: "ZAR",
          created_at: "2026-01-01T00:00:00Z",
          buyer_id: "buyer-1",
        },
      ],
      error: null,
    });
    mockSupabase.queue("order_items", { data: [], error: null });
    mockSupabase.queue("payments", { data: [], error: null });
    mockSupabase.queue("profiles_public", { data: [], error: null });
    mockSupabase.queue("disputes", { data: [], error: null });

    const result = await getSellerOrders("seller-1");

    expect(result[0].payment_method).toBe("online");
    expect(result[0].coverImagePath).toBeNull();
    expect(result[0].hasActiveDispute).toBe(false);
  });
});

describe("getBusinessOrders (Phase 13B)", () => {
  it("scopes the orders read to the one business by id — never a broad read filtered afterwards, and never trusting any other id", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    await getBusinessOrders("biz-1");
    expect(mockSupabase.chains.orders[0].eq).toHaveBeenCalledWith("business_id", "biz-1");
    expect(mockSupabase.chains.orders[0].or).not.toHaveBeenCalled();
  });

  it("does not resolve the caller's business memberships itself — RLS (is_business_member) plus the explicit business_id filter are the boundary, and the page has already gated on membership", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    await getBusinessOrders("biz-1");
    expect(mockSupabase.fromCalls).not.toContain("businesses");
    expect(mockSupabase.fromCalls).not.toContain("business_members");
  });

  it("returns [] for a business the caller isn't a member of (RLS yields no rows) or on a query error", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    expect(await getBusinessOrders("someone-elses-biz")).toEqual([]);
    mockSupabase.queue("orders", { data: null, error: { message: "boom" } });
    expect(await getBusinessOrders("biz-1")).toEqual([]);
  });

  it("shapes each order exactly like the personal seller list: buyer's public name only, no commission/delivery-cost/private fields", async () => {
    mockSupabase.queue("orders", {
      data: [{ id: "o1", order_reference: "BMB-1", status: "confirmed", fulfilment_type: "collection", total_cents: 9000, currency: "ZAR", created_at: "2026-01-01T00:00:00Z", buyer_id: "b1" }],
      error: null,
    });
    mockSupabase.queue("order_items", { data: [{ order_id: "o1", product_id: "p1", title_snapshot: "Cot" }], error: null });
    mockSupabase.queue("payments", { data: [{ order_id: "o1", status: "paid", method: "online" }], error: null });
    mockSupabase.queue("profiles_public", { data: [{ id: "b1", full_name: "Buyer Bee" }], error: null });
    const [order] = await getBusinessOrders("biz-1");
    expect(order).toEqual(expect.objectContaining({ id: "o1", buyerName: "Buyer Bee", payment_status: "paid", payment_method: "online" }));
    expect(Object.keys(order).sort()).toEqual(
      ["buyerName", "coverImagePath", "created_at", "currency", "fulfilment_type", "hasActiveDispute", "id", "order_reference", "payment_method", "payment_status", "productTitle", "status", "total_cents"].sort(),
    );
  });
});
