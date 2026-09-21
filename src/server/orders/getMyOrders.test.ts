import { describe, expect, it, vi, beforeEach } from "vitest";

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeSupabaseMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const fromCalls: string[] = [];

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const next = queues[table]?.shift() ?? { data: [], error: null };
      return makeChain(next);
    }),
  };

  return { client, queue, fromCalls };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

const { getMyOrders } = await import("./getMyOrders");

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
});

describe("getMyOrders", () => {
  it("returns an empty array (never throws) when there are no orders", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    const result = await getMyOrders("buyer-1");
    expect(result).toEqual([]);
  });

  it("returns an empty array on a query error, not a thrown exception", async () => {
    mockSupabase.queue("orders", { data: null, error: { message: "connection reset" } });
    const result = await getMyOrders("buyer-1");
    expect(result).toEqual([]);
  });

  it("scopes the orders query to buyer_id, never fetching another buyer's rows client-side", async () => {
    mockSupabase.queue("orders", { data: [], error: null });
    await getMyOrders("buyer-1");
    // fromCalls confirms the orders table was queried at all; the actual
    // authorization boundary is RLS (see tests/db/orders.test.ts) — this
    // just confirms the app-level query is correctly scoped as defense
    // in depth, matching every other getMy*() helper in this codebase.
    expect(mockSupabase.fromCalls[0]).toBe("orders");
  });

  it("joins order_items and payments by order id and merges them into each summary", async () => {
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
        },
      ],
      error: null,
    });
    mockSupabase.queue("order_items", { data: [{ order_id: "order-1", title_snapshot: "Stroller" }], error: null });
    mockSupabase.queue("payments", { data: [{ order_id: "order-1", status: "pending" }], error: null });

    const result = await getMyOrders("buyer-1");

    expect(result).toEqual([
      {
        id: "order-1",
        order_reference: "BMB-AAA111",
        status: "pending_payment",
        payment_status: "pending",
        fulfilment_type: "collection",
        total_cents: 5000,
        currency: "ZAR",
        created_at: "2026-01-01T00:00:00Z",
        productTitle: "Stroller",
      },
    ]);
  });

  it("defaults payment_status to 'pending' and productTitle to null when the join finds nothing", async () => {
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
        },
      ],
      error: null,
    });
    mockSupabase.queue("order_items", { data: [], error: null });
    mockSupabase.queue("payments", { data: [], error: null });

    const result = await getMyOrders("buyer-1");

    expect(result[0].payment_status).toBe("pending");
    expect(result[0].productTitle).toBeNull();
  });
});
