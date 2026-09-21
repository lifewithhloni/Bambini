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

const { getSellerOrders } = await import("./getSellerOrders");

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
    mockSupabase.queue("order_items", { data: [{ order_id: "order-1", title_snapshot: "Stroller" }], error: null });
    mockSupabase.queue("payments", { data: [{ order_id: "order-1", status: "pending" }], error: null });
    mockSupabase.queue("profiles_public", { data: [{ id: "buyer-1", full_name: "Alice Buyer" }], error: null });

    const result = await getSellerOrders("seller-1");

    expect(result).toEqual([
      expect.objectContaining({
        id: "order-1",
        productTitle: "Stroller",
        payment_status: "pending",
        buyerName: "Alice Buyer",
      }),
    ]);
    expect(mockSupabase.fromCalls).toContain("profiles_public");
  });
});
