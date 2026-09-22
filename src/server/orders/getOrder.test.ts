import { describe, expect, it, vi, beforeEach } from "vitest";

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
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
      const next = queues[table]?.shift() ?? { data: null, error: null };
      return makeChain(next);
    }),
  };

  return { client, queue, fromCalls };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

const getDeliveryTrackingMock = vi.fn();
vi.mock("@/server/delivery/trackingService", () => ({
  getDeliveryTracking: getDeliveryTrackingMock,
}));

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

const { getOrder } = await import("./getOrder");

const baseOrder = {
  id: "order-1",
  order_reference: "BMB-AAA111",
  status: "pending_payment",
  fulfilment_type: "collection",
  subtotal_cents: 50000,
  delivery_fee_cents: 0,
  total_cents: 50000,
  commission_rate_bps: 1200,
  commission_amount_cents: 6000,
  currency: "ZAR",
  created_at: "2026-01-01T00:00:00Z",
  buyer_id: "buyer-1",
  seller_profile_id: "seller-1",
  business_id: null,
  seller_type: "parent",
};

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
  getDeliveryTrackingMock.mockReset();
});

describe("getOrder", () => {
  it("returns null when the order doesn't exist or isn't visible to the caller (RLS-filtered)", async () => {
    mockSupabase.queue("orders", { data: null, error: null });
    const result = await getOrder("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null on a query error, not a thrown exception", async () => {
    mockSupabase.queue("orders", { data: null, error: { message: "connection reset" } });
    const result = await getOrder("order-1");
    expect(result).toBeNull();
  });

  it("shapes a full order for a parent-seller listing, including commission fields (display-level hiding happens in the UI, not here)", async () => {
    mockSupabase.queue("orders", { data: baseOrder, error: null });
    mockSupabase.queue("order_items", {
      data: { product_id: "product-1", title_snapshot: "Stroller", price_cents_snapshot: 50000 },
      error: null,
    });
    mockSupabase.queue("payments", { data: { status: "pending", method: "online" }, error: null });
    mockSupabase.queue("commissions", { data: { settlement_status: "collected_via_payment" }, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Bob Buyer" }, error: null }); // buyer lookup
    mockSupabase.queue("product_images", { data: [{ storage_path: "product-1/a.jpg", sort_order: 0 }], error: null });
    mockSupabase.queue("product_locations_public", { data: { suburb: "Gardens", city: "Cape Town" }, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Alice Seller" }, error: null }); // seller lookup

    const result = await getOrder("order-1");

    expect(result).toEqual({
      id: "order-1",
      order_reference: "BMB-AAA111",
      status: "pending_payment",
      payment_status: "pending",
      payment_method: "online",
      commission_settlement_status: "collected_via_payment",
      fulfilment_type: "collection",
      subtotal_cents: 50000,
      delivery_fee_cents: 0,
      total_cents: 50000,
      commission_rate_bps: 1200,
      commission_amount_cents: 6000,
      currency: "ZAR",
      created_at: "2026-01-01T00:00:00Z",
      buyer_id: "buyer-1",
      seller_profile_id: "seller-1",
      business_id: null,
      seller_type: "parent",
      item: {
        productId: "product-1",
        title: "Stroller",
        priceCents: 50000,
        coverImagePath: "product-1/a.jpg",
      },
      buyerName: "Bob Buyer",
      sellerName: "Alice Seller",
      pickupLocation: { suburb: "Gardens", city: "Cape Town" },
      deliveryTracking: null,
    });
    expect(getDeliveryTrackingMock).not.toHaveBeenCalled();
  });

  it("Phase 7A: fetches buyer/seller-safe delivery tracking for a delivery order, never for a collection order", async () => {
    mockSupabase.queue("orders", { data: { ...baseOrder, fulfilment_type: "delivery", delivery_fee_cents: 4500, total_cents: 54500 }, error: null });
    mockSupabase.queue("order_items", { data: null, error: null });
    mockSupabase.queue("payments", { data: { status: "paid", method: "online" }, error: null });
    mockSupabase.queue("commissions", { data: { settlement_status: "collected_via_payment" }, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Bob Buyer" }, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Alice Seller" }, error: null });
    getDeliveryTrackingMock.mockResolvedValue({ status: "booked", label: "Booking confirmed" });

    const result = await getOrder("order-1");

    expect(getDeliveryTrackingMock).toHaveBeenCalledWith("order-1");
    expect(result?.deliveryTracking).toEqual({ status: "booked", label: "Booking confirmed" });
    expect(result?.delivery_fee_cents).toBe(4500);
  });

  it("resolves seller name from businesses_public for a business-type order", async () => {
    mockSupabase.queue("orders", {
      data: { ...baseOrder, seller_type: "business", seller_profile_id: null, business_id: "biz-1" },
      error: null,
    });
    mockSupabase.queue("order_items", { data: null, error: null });
    mockSupabase.queue("payments", { data: { status: "paid", method: "online" }, error: null });
    mockSupabase.queue("commissions", { data: { settlement_status: "collected_via_payment" }, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Bob Buyer" }, error: null });
    mockSupabase.queue("businesses_public", { data: { business_name: "Alice's Shop" }, error: null });

    const result = await getOrder("order-1");

    expect(result?.sellerName).toBe("Alice's Shop");
    expect(result?.item).toBeNull();
  });

  it("defaults payment_status to 'pending' when no payment row is found", async () => {
    mockSupabase.queue("orders", { data: baseOrder, error: null });
    mockSupabase.queue("order_items", { data: null, error: null });
    mockSupabase.queue("payments", { data: null, error: null });
    mockSupabase.queue("commissions", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });

    const result = await getOrder("order-1");
    expect(result?.payment_status).toBe("pending");
    expect(result?.payment_method).toBe("online");
    expect(result?.commission_settlement_status).toBeNull();
  });
});
