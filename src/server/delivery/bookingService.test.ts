import { describe, expect, it, vi, beforeEach } from "vitest";

// See src/server/auth/requireUser.test.ts for why this stub is needed.
vi.mock("server-only", () => ({}));

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

function makeAdminMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const fromCalls: string[] = [];
  const rpcMock = vi.fn();

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

let mockAdmin: ReturnType<typeof makeAdminMock>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdmin.client),
}));

const getActiveDeliveryProvidersMock = vi.fn();
vi.mock("./registry", () => ({
  getActiveDeliveryProviders: getActiveDeliveryProvidersMock,
}));

const { bookDeliveryForOrder } = await import("./bookingService");

beforeEach(() => {
  mockAdmin = makeAdminMock();
  getActiveDeliveryProvidersMock.mockReset();
});

describe("bookDeliveryForOrder", () => {
  it("is a no-op for a collection order — never calls reserve_delivery_order or any provider", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "collection" }, error: null });
    await bookDeliveryForOrder("order-1");
    expect(mockAdmin.rpcMock).not.toHaveBeenCalled();
  });

  it("logs and returns without booking if a delivery order has no attached delivery_quotes row", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "delivery" }, error: null });
    mockAdmin.queue("delivery_quotes", { data: null, error: null });
    await bookDeliveryForOrder("order-1");
    expect(mockAdmin.rpcMock).not.toHaveBeenCalled();
  });

  it("is idempotent — when reserve_delivery_order() returns null (already reserved/booked), never calls the provider", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "delivery" }, error: null });
    mockAdmin.queue("delivery_quotes", { data: { id: "quote-1", provider_id: "provider-1", pickup_location_id: "loc-a", dropoff_location_id: "loc-b", provider_quote_ref: "ref-1" }, error: null });
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: null, error: null }); // reserve_delivery_order -> null

    const bookDelivery = vi.fn();
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", bookDelivery }]);

    await bookDeliveryForOrder("order-1");
    expect(bookDelivery).not.toHaveBeenCalled();
    expect(mockAdmin.rpcMock).toHaveBeenCalledTimes(1); // only the reserve call
  });

  it("books successfully: reserves, re-validates the provider, calls it with an idempotency key, and records a 'booked' outcome", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "delivery" }, error: null });
    mockAdmin.queue("delivery_quotes", { data: { id: "quote-1", provider_id: "provider-1", pickup_location_id: "loc-a", dropoff_location_id: "loc-b", provider_quote_ref: "ref-1" }, error: null });
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: "delivery-order-1", error: null }); // reserve
    mockAdmin.queue("delivery_providers", { data: { slug: "mock", is_active: true }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null }); // pickup
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null }); // dropoff

    const bookDelivery = vi.fn().mockResolvedValue({ providerSlug: "mock", providerTrackingRef: "track-1", status: "booked" });
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", bookDelivery }]);
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: null, error: null }); // record_delivery_booking

    await bookDeliveryForOrder("order-1");

    expect(bookDelivery).toHaveBeenCalledWith({
      providerQuoteRef: "ref-1",
      pickup: { latitude: -33.9, longitude: 18.4 },
      dropoff: { latitude: -33.95, longitude: 18.45 },
      orderId: "order-1",
      idempotencyKey: "delivery-order-1",
    });
    expect(mockAdmin.rpcMock).toHaveBeenCalledWith("record_delivery_booking", {
      p_delivery_order_id: "delivery-order-1",
      p_provider_tracking_ref: "track-1",
      p_status: "booked",
    });
  });

  it("records a 'failed' outcome (never a duplicate reservation) when the provider throws", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "delivery" }, error: null });
    mockAdmin.queue("delivery_quotes", { data: { id: "quote-1", provider_id: "provider-1", pickup_location_id: "loc-a", dropoff_location_id: "loc-b", provider_quote_ref: "ref-1" }, error: null });
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: "delivery-order-1", error: null }); // reserve
    mockAdmin.queue("delivery_providers", { data: { slug: "mock", is_active: true }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null });

    const bookDelivery = vi.fn().mockRejectedValue(new Error("provider unreachable"));
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", bookDelivery }]);
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: null, error: null }); // record_delivery_booking

    await bookDeliveryForOrder("order-1");

    expect(mockAdmin.rpcMock).toHaveBeenLastCalledWith("record_delivery_booking", {
      p_delivery_order_id: "delivery-order-1",
      p_provider_tracking_ref: null,
      p_status: "failed",
    });
  });

  it("records a 'failed' outcome when no active registered provider matches the quote's provider slug", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "delivery" }, error: null });
    mockAdmin.queue("delivery_quotes", { data: { id: "quote-1", provider_id: "provider-1", pickup_location_id: "loc-a", dropoff_location_id: "loc-b", provider_quote_ref: "ref-1" }, error: null });
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: "delivery-order-1", error: null }); // reserve
    mockAdmin.queue("delivery_providers", { data: { slug: "some_disabled_provider", is_active: true }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([]); // nothing registered

    mockAdmin.rpcMock.mockResolvedValueOnce({ data: null, error: null }); // record_delivery_booking

    await bookDeliveryForOrder("order-1");

    expect(mockAdmin.rpcMock).toHaveBeenLastCalledWith("record_delivery_booking", {
      p_delivery_order_id: "delivery-order-1",
      p_provider_tracking_ref: null,
      p_status: "failed",
    });
  });

  it("Phase 7B: records a 'failed' outcome, and never calls the provider, when the provider was disabled in the database after order creation", async () => {
    mockAdmin.queue("orders", { data: { id: "order-1", fulfilment_type: "delivery" }, error: null });
    mockAdmin.queue("delivery_quotes", { data: { id: "quote-1", provider_id: "provider-1", pickup_location_id: "loc-a", dropoff_location_id: "loc-b", provider_quote_ref: "ref-1" }, error: null });
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: "delivery-order-1", error: null }); // reserve
    // Still code-registered, but disabled in the database — this is
    // exactly the gap the Phase 7B inspection found: create_order() only
    // ever checked is_active once, at quote-validation time.
    mockAdmin.queue("delivery_providers", { data: { slug: "mock", is_active: false }, error: null });

    const bookDelivery = vi.fn();
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", bookDelivery }]);
    mockAdmin.rpcMock.mockResolvedValueOnce({ data: null, error: null }); // record_delivery_booking

    await bookDeliveryForOrder("order-1");

    expect(bookDelivery).not.toHaveBeenCalled();
    expect(mockAdmin.rpcMock).toHaveBeenLastCalledWith("record_delivery_booking", {
      p_delivery_order_id: "delivery-order-1",
      p_provider_tracking_ref: null,
      p_status: "failed",
    });
  });
});
