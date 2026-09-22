import { describe, expect, it, vi, beforeEach } from "vitest";

// The real `server-only` package throws when imported outside Next's
// bundler (which normally strips it to a no-op); stub it so this file
// is importable under plain Vitest/Node — same pattern as
// src/server/auth/requireUser.test.ts.
vi.mock("server-only", () => ({}));

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.insert = vi.fn(self);
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

let mockSupabase: ReturnType<typeof makeSupabaseMock>;
let mockAdmin: ReturnType<typeof makeSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdmin.client),
}));

const getAllDeliveryQuotesMock = vi.fn();
vi.mock("./registry", () => ({
  getAllDeliveryQuotes: getAllDeliveryQuotesMock,
}));

const { fetchDeliveryQuotesForProduct } = await import("./quoteService");

const buyer = { id: "buyer-1", email: "buyer@example.com" } as Parameters<typeof fetchDeliveryQuotesForProduct>[0];

const mockProviderQuotes = [
  { providerSlug: "mock", serviceLevel: "cheapest", priceCents: 2500, currency: "ZAR", etaMinMinutes: 180, etaMaxMinutes: 300, providerQuoteRef: "ref-1", expiresAt: new Date("2026-01-01T01:00:00Z") },
  { providerSlug: "mock", serviceLevel: "express", priceCents: 6000, currency: "ZAR", etaMinMinutes: 30, etaMaxMinutes: 60, providerQuoteRef: "ref-2", expiresAt: new Date("2026-01-01T01:00:00Z") },
];

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
  mockAdmin = makeSupabaseMock();
  getAllDeliveryQuotesMock.mockReset();
});

describe("fetchDeliveryQuotesForProduct", () => {
  it("returns an error without calling any provider when the product isn't published/found", async () => {
    mockSupabase.queue("products", { data: null, error: null });
    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(getAllDeliveryQuotesMock).not.toHaveBeenCalled();
  });

  it("returns an error when delivery isn't available for the listing", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: false }, error: null });
    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(getAllDeliveryQuotesMock).not.toHaveBeenCalled();
  });

  it("returns an error when the buyer has no saved location, without ever reading the seller's", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: null }, error: null }); // buyer
    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(getAllDeliveryQuotesMock).not.toHaveBeenCalled();
  });

  it("returns an error when the seller (parent) has no saved location", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "buyer-loc" }, error: null }); // buyer
    mockAdmin.queue("profiles", { data: { location_id: null }, error: null }); // seller
    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("resolves a business seller's pickup point from businesses.location_id, not profiles", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "business", seller_profile_id: null, business_id: "biz-1", delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "buyer-loc" }, error: null }); // buyer
    mockAdmin.queue("businesses", { data: { location_id: "biz-loc" }, error: null }); // seller (business)
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null }); // pickup
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null }); // dropoff
    getAllDeliveryQuotesMock.mockResolvedValue(mockProviderQuotes);
    mockAdmin.queue("delivery_providers", { data: [{ id: "provider-1", slug: "mock", name: "Mock Delivery", is_active: true }], error: null });
    mockAdmin.queue("delivery_quotes", {
      data: [
        { id: "q1", service_level: "cheapest", price_cents: 2500, currency: "ZAR", eta_min_minutes: 180, eta_max_minutes: 300, expires_at: "2026-01-01T01:00:00Z", provider_id: "provider-1" },
        { id: "q2", service_level: "express", price_cents: 6000, currency: "ZAR", eta_min_minutes: 30, eta_max_minutes: 60, expires_at: "2026-01-01T01:00:00Z", provider_id: "provider-1" },
      ],
      error: null,
    });

    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result.ok).toBe(true);
    expect(mockAdmin.fromCalls).toContain("businesses");
  });

  it("returns quotes sorted cheapest-first, with no coordinates/location ids/raw provider data in the result", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "buyer-loc" }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "seller-loc" }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null });
    getAllDeliveryQuotesMock.mockResolvedValue(mockProviderQuotes);
    mockAdmin.queue("delivery_providers", { data: [{ id: "provider-1", slug: "mock", name: "Mock Delivery", is_active: true }], error: null });
    mockAdmin.queue("delivery_quotes", {
      data: [
        { id: "q2", service_level: "express", price_cents: 6000, currency: "ZAR", eta_min_minutes: 30, eta_max_minutes: 60, expires_at: "2026-01-01T01:00:00Z", provider_id: "provider-1" },
        { id: "q1", service_level: "cheapest", price_cents: 2500, currency: "ZAR", eta_min_minutes: 180, eta_max_minutes: 300, expires_at: "2026-01-01T01:00:00Z", provider_id: "provider-1" },
      ],
      error: null,
    });

    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    if (!result.ok) throw new Error("expected ok");
    expect(result.quotes.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(result.quotes[0]).toEqual({
      id: "q1",
      serviceLevel: "cheapest",
      priceCents: 2500,
      currency: "ZAR",
      etaMinMinutes: 180,
      etaMaxMinutes: 300,
      providerName: "Mock Delivery",
      expiresAt: "2026-01-01T01:00:00Z",
    });
    for (const key of Object.keys(result.quotes[0])) {
      expect(["location", "coordinate", "requested_by", "raw"].some((forbidden) => key.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("drops a provider quote whose slug has no active delivery_providers row (registry/DB drift guard) instead of persisting an unbookable quote", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "buyer-loc" }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "seller-loc" }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null });
    getAllDeliveryQuotesMock.mockResolvedValue(mockProviderQuotes);
    // Registered in code (DELIVERY_PROVIDERS) but NOT active in the DB —
    // the empty list here models "no matching active row at all".
    mockAdmin.queue("delivery_providers", { data: [], error: null });

    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(mockAdmin.fromCalls).not.toContain("delivery_quotes");
  });

  it("returns an error when the provider layer returns zero quotes", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "buyer-loc" }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "seller-loc" }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null });
    getAllDeliveryQuotesMock.mockResolvedValue([]);
    const result = await fetchDeliveryQuotesForProduct(buyer, "product-1");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("persists requested_by/product_id on every inserted quote row (ownership + replay-prevention columns)", async () => {
    mockSupabase.queue("products", { data: { id: "product-1", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, delivery_available: true }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "buyer-loc" }, error: null });
    mockAdmin.queue("profiles", { data: { location_id: "seller-loc" }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.9, longitude: 18.4 }, error: null });
    mockAdmin.queue("locations", { data: { latitude: -33.95, longitude: 18.45 }, error: null });
    getAllDeliveryQuotesMock.mockResolvedValue([mockProviderQuotes[0]]);
    mockAdmin.queue("delivery_providers", { data: [{ id: "provider-1", slug: "mock", name: "Mock Delivery", is_active: true }], error: null });
    mockAdmin.queue("delivery_quotes", {
      data: [{ id: "q1", service_level: "cheapest", price_cents: 2500, currency: "ZAR", eta_min_minutes: 180, eta_max_minutes: 300, expires_at: "2026-01-01T01:00:00Z", provider_id: "provider-1" }],
      error: null,
    });

    await fetchDeliveryQuotesForProduct(buyer, "product-1");

    const deliveryQuotesIndex = mockAdmin.fromCalls.lastIndexOf("delivery_quotes");
    const deliveryQuotesChain = mockAdmin.client.from.mock.results[deliveryQuotesIndex].value as { insert: ReturnType<typeof vi.fn> };
    const insertedRows = deliveryQuotesChain.insert.mock.calls[0][0];
    expect(insertedRows[0]).toMatchObject({ requested_by: "buyer-1", product_id: "product-1" });
  });
});
