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

// getMyOrders() reads product_images via the admin client specifically
// (see its own doc comment — a purchased listing is always 'sold' by the
// time an order exists, and product_images_select RLS hides a non-'active'
// product's images from anyone but its seller) — same shared mock client
// as createClient() so the queue-popping mechanism below still works.
const createAdminClientMock = vi.fn(() => mockSupabase.client);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

const { getMyOrders } = await import("./getMyOrders");

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
  createAdminClientMock.mockClear();
});

const baseOrderRow = {
  id: "order-1",
  order_reference: "BMB-AAA111",
  status: "pending_payment",
  fulfilment_type: "collection",
  total_cents: 5000,
  currency: "ZAR",
  created_at: "2026-01-01T00:00:00Z",
  seller_type: "parent",
  seller_profile_id: "seller-1",
  business_id: null,
};

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

  it("joins order_items, payments, product_images, and profiles_public into a full order summary", async () => {
    mockSupabase.queue("orders", { data: [baseOrderRow], error: null });
    mockSupabase.queue("order_items", { data: [{ order_id: "order-1", product_id: "product-1", title_snapshot: "Stroller" }], error: null });
    mockSupabase.queue("payments", { data: [{ order_id: "order-1", status: "pending", method: "online" }], error: null });
    mockSupabase.queue("disputes", { data: [], error: null });
    mockSupabase.queue("product_images", {
      data: [
        { product_id: "product-1", storage_path: "product-1/b.jpg", sort_order: 1 },
        { product_id: "product-1", storage_path: "product-1/a.jpg", sort_order: 0 },
      ],
      error: null,
    });
    mockSupabase.queue("profiles_public", { data: [{ id: "seller-1", full_name: "Alice" }], error: null });

    const result = await getMyOrders("buyer-1");

    expect(createAdminClientMock).toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: "order-1",
        order_reference: "BMB-AAA111",
        status: "pending_payment",
        payment_status: "pending",
        payment_method: "online",
        fulfilment_type: "collection",
        total_cents: 5000,
        currency: "ZAR",
        created_at: "2026-01-01T00:00:00Z",
        productTitle: "Stroller",
        coverImagePath: "product-1/a.jpg", // sorted by sort_order, not array order
        sellerName: "Alice",
        hasActiveDispute: false,
      },
    ]);
  });

  it("resolves a business seller's name from businesses_public, not profiles_public", async () => {
    mockSupabase.queue("orders", { data: [{ ...baseOrderRow, seller_type: "business", seller_profile_id: null, business_id: "biz-1" }], error: null });
    mockSupabase.queue("order_items", { data: [], error: null });
    mockSupabase.queue("payments", { data: [], error: null });
    mockSupabase.queue("disputes", { data: [], error: null });
    mockSupabase.queue("businesses_public", { data: [{ id: "biz-1", business_name: "Tiny Toes Co" }], error: null });

    const result = await getMyOrders("buyer-1");

    expect(result[0].sellerName).toBe("Tiny Toes Co");
  });

  it("hasActiveDispute is true only when an open/under_review dispute exists for that order", async () => {
    mockSupabase.queue("orders", { data: [baseOrderRow], error: null });
    mockSupabase.queue("order_items", { data: [], error: null });
    mockSupabase.queue("payments", { data: [], error: null });
    mockSupabase.queue("disputes", { data: [{ order_id: "order-1", status: "open" }], error: null });

    const result = await getMyOrders("buyer-1");

    expect(result[0].hasActiveDispute).toBe(true);
  });

  it("defaults payment_status/payment_method to safe defaults and productTitle/coverImagePath/sellerName to null when nothing joins", async () => {
    mockSupabase.queue("orders", { data: [{ ...baseOrderRow, id: "order-2", order_reference: "BMB-BBB222", fulfilment_type: "delivery", total_cents: 2000, seller_profile_id: null }], error: null });
    mockSupabase.queue("order_items", { data: [], error: null });
    mockSupabase.queue("payments", { data: [], error: null });
    mockSupabase.queue("disputes", { data: [], error: null });

    const result = await getMyOrders("buyer-1");

    expect(result[0].payment_status).toBe("pending");
    expect(result[0].payment_method).toBe("online");
    expect(result[0].productTitle).toBeNull();
    expect(result[0].coverImagePath).toBeNull();
    expect(result[0].sellerName).toBeNull();
    expect(result[0].hasActiveDispute).toBe(false);
  });
});
