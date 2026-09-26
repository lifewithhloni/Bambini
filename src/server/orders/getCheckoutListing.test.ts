import { describe, expect, it, vi, beforeEach } from "vitest";

// Same reusable mock query-builder pattern as
// src/server/listings/getPublicListing.test.ts — each `.from(table)`
// call pops the next queued response for that table, and `.rpc(name)`
// pops the next queued RPC response, mirroring
// src/server/orders/actions.test.ts's rpc mock.
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

function makeSupabaseMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const rpcQueue: QueuedResult[] = [];

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }
  function queueRpc(result: QueuedResult) {
    rpcQueue.push(result);
  }

  const client = {
    from: vi.fn((table: string) => {
      const next = queues[table]?.shift() ?? { data: null, error: null };
      return makeChain(next);
    }),
    rpc: vi.fn(() => Promise.resolve(rpcQueue.shift() ?? { data: null, error: null })),
  };

  return { client, queue, queueRpc };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

const { getCheckoutListing } = await import("./getCheckoutListing");

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
});

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

function queueBaseProduct(overrides: Partial<Record<string, unknown>> = {}) {
  mockSupabase.queue("products", {
    data: {
      id: PRODUCT_ID,
      title: "Stroller",
      condition: "good",
      price_cents: 5000,
      currency: "ZAR",
      collection_available: true,
      delivery_available: false,
      seller_type: "parent",
      seller_profile_id: "seller-1",
      business_id: null,
      product_images: [],
      ...overrides,
    },
    error: null,
  });
}

describe("getCheckoutListing", () => {
  it("returns null for a listing that isn't published (sold/draft/archived/nonexistent — RLS/explicit filter would hide all of these identically)", async () => {
    mockSupabase.queue("products", { data: null, error: null });
    const listing = await getCheckoutListing(PRODUCT_ID);
    expect(listing).toBeNull();
  });

  it("always queries with an explicit status = 'published' filter — defense in depth alongside RLS", async () => {
    mockSupabase.queue("products", { data: null, error: null });
    await getCheckoutListing(PRODUCT_ID);
    const productsChain = (mockSupabase.client.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(productsChain.eq).toHaveBeenCalledWith("status", "published");
  });

  it("returns the public-safe field set for a parent seller, including condition and an approximate location", async () => {
    queueBaseProduct();
    mockSupabase.queue("product_locations_public", { data: { suburb: "Rosebank", city: "Johannesburg", province: "Gauteng" }, error: null });
    mockSupabase.queue("profiles_public", {
      data: { full_name: "Alice", avatar_url: "https://example.com/a.jpg", identity_verification: "verified" },
      error: null,
    });

    const listing = await getCheckoutListing(PRODUCT_ID);

    expect(listing).toEqual(
      expect.objectContaining({
        id: PRODUCT_ID,
        title: "Stroller",
        condition: "good",
        priceCents: 5000,
        sellerName: "Alice",
        sellerAvatarUrl: "https://example.com/a.jpg",
        sellerIsVerified: true,
        location: { suburb: "Rosebank", city: "Johannesburg", province: "Gauteng" },
        cashOffered: false,
      }),
    );
  });

  it("a parent seller with a pending (not yet approved) identity verification never renders as verified", async () => {
    queueBaseProduct();
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Alice", avatar_url: null, identity_verification: "pending" }, error: null });

    const listing = await getCheckoutListing(PRODUCT_ID);
    expect(listing!.sellerIsVerified).toBe(false);
  });

  it("a business seller's badge/name/logo come from businesses_public.verification_status, not the parent-profile fields", async () => {
    queueBaseProduct({ seller_type: "business", seller_profile_id: null, business_id: "biz-1" });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("businesses_public", {
      data: { business_name: "Tiny Toes Co", logo_url: "https://example.com/logo.png", verification_status: "verified" },
      error: null,
    });

    const listing = await getCheckoutListing(PRODUCT_ID);

    expect(listing).toEqual(
      expect.objectContaining({
        sellerName: "Tiny Toes Co",
        sellerAvatarUrl: "https://example.com/logo.png",
        sellerIsVerified: true,
      }),
    );
  });

  it("returns location: null when the product has no public location row, rather than throwing", async () => {
    queueBaseProduct();
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });

    const listing = await getCheckoutListing(PRODUCT_ID);
    expect(listing!.location).toBeNull();
  });

  it("cashOffered is false when the listing doesn't support collection at all — no eligibility RPC is even called", async () => {
    queueBaseProduct({ collection_available: false });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });

    const listing = await getCheckoutListing(PRODUCT_ID);

    expect(listing!.cashOffered).toBe(false);
    expect(mockSupabase.client.rpc).not.toHaveBeenCalled();
  });

  it("cashOffered is true only when the global cash switch is on AND the seller is freshly evaluated as eligible", async () => {
    queueBaseProduct({ collection_available: true });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });
    mockSupabase.queue("cash_settings", { data: { is_enabled: true }, error: null });
    mockSupabase.queueRpc({ data: true, error: null });

    const listing = await getCheckoutListing(PRODUCT_ID);
    expect(listing!.cashOffered).toBe(true);
  });

  it("cashOffered is false when the global cash switch is off, even if the seller would otherwise be eligible", async () => {
    queueBaseProduct({ collection_available: true });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });
    mockSupabase.queue("cash_settings", { data: { is_enabled: false }, error: null });
    mockSupabase.queueRpc({ data: true, error: null });

    const listing = await getCheckoutListing(PRODUCT_ID);
    expect(listing!.cashOffered).toBe(false);
  });

  it("never returns a field carrying delivery provider cost, commission, or private seller identifiers — exact public-safe key set", async () => {
    queueBaseProduct();
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: { full_name: "Alice", avatar_url: null, identity_verification: "verified" }, error: null });

    const listing = await getCheckoutListing(PRODUCT_ID);

    expect(Object.keys(listing!).sort()).toEqual(
      [
        "id",
        "title",
        "condition",
        "priceCents",
        "currency",
        "collectionAvailable",
        "deliveryAvailable",
        "coverImagePath",
        "sellerType",
        "sellerProfileId",
        "businessId",
        "sellerName",
        "sellerAvatarUrl",
        "sellerIsVerified",
        "location",
        "cashOffered",
      ].sort(),
    );
  });
});
