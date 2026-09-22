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
  const rpcMock = vi.fn();

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }

  const client = {
    from: vi.fn((table: string) => {
      const next = queues[table]?.shift() ?? { data: null, error: null };
      return makeChain(next);
    }),
    rpc: rpcMock,
  };

  return { client, queue, rpcMock };
}

let mockAdmin: ReturnType<typeof makeAdminMock>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdmin.client),
}));

const getActiveDeliveryProvidersMock = vi.fn();
vi.mock("./registry", () => ({
  getActiveDeliveryProviders: getActiveDeliveryProvidersMock,
}));

const { getDeliveryTracking } = await import("./trackingService");

beforeEach(() => {
  mockAdmin = makeAdminMock();
  getActiveDeliveryProvidersMock.mockReset();
});

describe("getDeliveryTracking", () => {
  it("returns null when the order has no delivery_orders row yet (not booked)", async () => {
    mockAdmin.queue("delivery_orders", { data: null, error: null });
    const result = await getDeliveryTracking("order-1");
    expect(result).toBeNull();
  });

  it("returns the stored status without polling the provider when there's no tracking ref yet", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: null, status: "pending" }, error: null });
    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "pending", label: "Booking pending" });
    expect(getActiveDeliveryProvidersMock).not.toHaveBeenCalled();
  });

  it("returns the stored status when no active registered provider matches", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked" }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([]);
    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
  });

  it("returns the stored status if the provider call throws, rather than failing the page", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked" }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockRejectedValue(new Error("unreachable")) }]);
    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
  });

  it("does not sync when the live status matches the stored status", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked" }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockResolvedValue("booked") }]);
    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
    expect(mockAdmin.rpcMock).not.toHaveBeenCalled();
  });

  it("syncs and returns the new status when the live provider status has changed", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked" }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockResolvedValue("delivered") }]);
    mockAdmin.rpcMock.mockResolvedValue({ error: null });

    const result = await getDeliveryTracking("order-1");

    expect(mockAdmin.rpcMock).toHaveBeenCalledWith("sync_delivery_status", { p_order_id: "order-1", p_status: "delivered" });
    expect(result).toEqual({ status: "delivered", label: "Delivered" });
  });

  it("falls back to the last known status if syncing the new one fails", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked" }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockResolvedValue("delivered") }]);
    mockAdmin.rpcMock.mockResolvedValue({ error: { message: "connection reset" } });

    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
  });
});
