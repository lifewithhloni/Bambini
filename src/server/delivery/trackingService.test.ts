import { describe, expect, it, vi, beforeEach } from "vitest";

// See src/server/auth/requireUser.test.ts for why this stub is needed.
vi.mock("server-only", () => ({}));

const COOLDOWN_SECONDS = 60;
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({ DELIVERY_TRACKING_POLL_COOLDOWN_SECONDS: COOLDOWN_SECONDS }),
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

const longAgo = new Date(Date.now() - (COOLDOWN_SECONDS + 30) * 1000).toISOString();
const justNow = new Date(Date.now() - 5 * 1000).toISOString();

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
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: null, status: "pending", last_synced_at: null }, error: null });
    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "pending", label: "Booking pending" });
    expect(getActiveDeliveryProvidersMock).not.toHaveBeenCalled();
  });

  describe("terminal states never poll again", () => {
    it.each(["delivered", "failed", "cancelled"] as const)("never calls the provider once status is '%s'", async (status) => {
      mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status, last_synced_at: longAgo }, error: null });
      const result = await getDeliveryTracking("order-1");
      expect(result?.status).toBe(status);
      expect(getActiveDeliveryProvidersMock).not.toHaveBeenCalled();
    });
  });

  describe("Phase 7B: polling cooldown", () => {
    it("within the cooldown window: returns the stored status without calling the provider", async () => {
      mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: justNow }, error: null });
      const result = await getDeliveryTracking("order-1");
      expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
      expect(getActiveDeliveryProvidersMock).not.toHaveBeenCalled();
    });

    it("cooldown expired: calls the provider and syncs the result", async () => {
      mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: longAgo }, error: null });
      mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
      const getStatus = vi.fn().mockResolvedValue("in_transit");
      getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus }]);
      mockAdmin.rpcMock.mockResolvedValue({ error: null });

      const result = await getDeliveryTracking("order-1");

      expect(getStatus).toHaveBeenCalledWith("track-1");
      expect(mockAdmin.rpcMock).toHaveBeenCalledWith("sync_delivery_status", { p_order_id: "order-1", p_status: "in_transit" });
      expect(result).toEqual({ status: "in_transit", label: "In transit" });
    });

    it("never synced before (last_synced_at is null): calls the provider immediately, cooldown or not", async () => {
      mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: null }, error: null });
      mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
      const getStatus = vi.fn().mockResolvedValue("booked");
      getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus }]);
      mockAdmin.rpcMock.mockResolvedValue({ error: null });

      await getDeliveryTracking("order-1");

      expect(getStatus).toHaveBeenCalledWith("track-1");
    });

    it("always syncs after a live poll, even when the status is unchanged (so last_synced_at still advances)", async () => {
      mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: longAgo }, error: null });
      mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
      getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockResolvedValue("booked") }]);
      mockAdmin.rpcMock.mockResolvedValue({ error: null });

      const result = await getDeliveryTracking("order-1");

      expect(mockAdmin.rpcMock).toHaveBeenCalledWith("sync_delivery_status", { p_order_id: "order-1", p_status: "booked" });
      expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
    });

    it("provider error past the cooldown: falls back to the last known status but still records the sync attempt (so a down provider is rate-limited too)", async () => {
      mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: longAgo }, error: null });
      mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
      getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockRejectedValue(new Error("unreachable")) }]);
      mockAdmin.rpcMock.mockResolvedValue({ error: null });

      const result = await getDeliveryTracking("order-1");

      expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
      expect(mockAdmin.rpcMock).toHaveBeenCalledWith("record_delivery_sync_attempt", { p_order_id: "order-1" });
    });
  });

  it("returns the stored status when no active registered provider matches", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: longAgo }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([]);
    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
  });

  it("falls back to the last known status if syncing the new one fails", async () => {
    mockAdmin.queue("delivery_orders", { data: { provider_id: "provider-1", provider_tracking_ref: "track-1", status: "booked", last_synced_at: longAgo }, error: null });
    mockAdmin.queue("delivery_providers", { data: { slug: "mock" }, error: null });
    getActiveDeliveryProvidersMock.mockReturnValue([{ slug: "mock", getStatus: vi.fn().mockResolvedValue("delivered") }]);
    mockAdmin.rpcMock.mockResolvedValue({ error: { message: "connection reset" } });

    const result = await getDeliveryTracking("order-1");
    expect(result).toEqual({ status: "booked", label: "Booking confirmed" });
  });
});
