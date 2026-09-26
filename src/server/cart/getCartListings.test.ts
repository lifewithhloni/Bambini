import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Same reusable mock query-builder pattern as
 * src/server/listings/getPublicListing.test.ts — each `.from(table)`
 * call pops the next queued response for that table. This file's job
 * is proving getCartListings() classifies statuses and resolves
 * ownership correctly from whatever rows it's handed, not re-proving
 * RLS itself (that's tests/db's job against a real Postgres engine).
 */
type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
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

  const createSignedUrlsMock = vi.fn(async () => ({ data: [] as { path: string; signedUrl: string | null; error: string | null }[], error: null }));
  const rpcMock = vi.fn(async (): Promise<{ data: boolean | null; error: unknown }> => ({ data: null, error: null }));

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const next = queues[table]?.shift() ?? { data: null, error: null };
      return makeChain(next);
    }),
    storage: { from: vi.fn(() => ({ createSignedUrls: createSignedUrlsMock })) },
    rpc: rpcMock,
  };

  return { client, queue, fromCalls, createSignedUrlsMock, rpcMock };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;
let mockUser: { id: string } | null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));
vi.mock("@/lib/supabase/admin", () => ({
  // The admin (service-role) client is a SEPARATE creator function from
  // the session-scoped one, but for this test's purposes it's fine for
  // both to resolve to the same mock query-queue — what's under test is
  // getCartListings()'s own classification logic, not which literal
  // client object issued which query.
  createAdminClient: vi.fn(() => mockSupabase.client),
}));
vi.mock("@/server/auth/requireUser", () => ({
  getOptionalUser: vi.fn(async () => mockUser),
}));

const { getCartListings } = await import("./getCartListings");

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
  mockUser = null;
});

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const NOT_A_UUID = "not-a-real-id";

function queueProducts(rows: Record<string, unknown>[]) {
  mockSupabase.queue("products", { data: rows, error: null });
}

describe("getCartListings — malformed input", () => {
  it("returns an empty result for an empty id list without querying anything", async () => {
    const result = await getCartListings([]);
    expect(result).toEqual({ lines: [], canTransact: null });
    expect(mockSupabase.client.from).not.toHaveBeenCalled();
  });

  it("silently drops anything that isn't a well-formed UUID — never lets malformed client data reach a query", async () => {
    queueProducts([]);
    const result = await getCartListings([NOT_A_UUID]);
    expect(result.lines).toEqual([]);
  });

  it("de-duplicates repeated ids", async () => {
    queueProducts([
      {
        id: PRODUCT_A,
        title: "Cot",
        price_cents: 30000,
        currency: "ZAR",
        condition: "good",
        status: "published",
        seller_type: "parent",
        seller_profile_id: "seller-1",
        business_id: null,
        product_images: [],
      },
    ]);
    const result = await getCartListings([PRODUCT_A, PRODUCT_A, PRODUCT_A]);
    expect(result.lines).toHaveLength(1);
  });
});

describe("getCartListings — a real fetch/database error is never mistaken for 'these listings don't exist'", () => {
  it("throws rather than silently reporting every cart line as deleted when the products query itself fails", async () => {
    mockSupabase.queue("products", { data: null, error: { message: "TypeError: fetch failed" } });
    await expect(getCartListings([PRODUCT_A])).rejects.toThrow(/fetch failed/i);
  });
});

describe("getCartListings — status classification", () => {
  it("G. a deleted/never-existed listing is reported as 'deleted', with no title/price to show", async () => {
    queueProducts([]); // the row simply isn't there
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines).toEqual([{ id: PRODUCT_A, status: "deleted", title: null, priceCents: null, currency: null, condition: null, imageUrl: null, sellerName: null }]);
  });

  it("F/N. a sold listing is reported as 'sold', not 'deleted' — the admin client sees it even though normal RLS would hide it", async () => {
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "sold", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
    ]);
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0].status).toBe("sold");
    // H. the price shown is still whatever the authoritative row says right now.
    expect(result.lines[0].priceCents).toBe(30000);
  });

  it("F/N. a draft or archived listing is reported as 'unavailable'", async () => {
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "archived", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
    ]);
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0].status).toBe("unavailable");
  });

  it("H. a published listing's current price is what's returned, never a stale add-to-cart-time value (nothing here even accepts one)", async () => {
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 45000, currency: "ZAR", condition: "good", status: "published", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
    ]);
    mockSupabase.queue("profiles_public", { data: [{ id: "seller-1", full_name: "Alice" }], error: null });
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0]).toMatchObject({ status: "available", priceCents: 45000, sellerName: "Alice" });
  });
});

describe("getCartListings — ownership (C, P)", () => {
  it("C. a parent seller viewing their own listing gets 'own_listing', never 'available'", async () => {
    mockUser = { id: "seller-1" };
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "published", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
    ]);
    mockSupabase.queue("profiles_public", { data: [{ id: "seller-1", full_name: "Alice" }], error: null });
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0].status).toBe("own_listing");
  });

  it("P. a business OWNER viewing their business's own listing gets 'own_listing'", async () => {
    mockUser = { id: "owner-1" };
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "published", seller_type: "business", seller_profile_id: null, business_id: "biz-1", product_images: [] },
    ]);
    mockSupabase.queue("businesses_public", { data: [{ id: "biz-1", business_name: "Tiny Toes" }], error: null });
    mockSupabase.queue("businesses", { data: [{ id: "biz-1" }], error: null }); // owns it
    mockSupabase.queue("business_members", { data: [], error: null });
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0].status).toBe("own_listing");
  });

  it("P. a business STAFF MEMBER (not the owner) viewing their business's own listing also gets 'own_listing'", async () => {
    mockUser = { id: "staff-1" };
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "published", seller_type: "business", seller_profile_id: null, business_id: "biz-1", product_images: [] },
    ]);
    mockSupabase.queue("businesses_public", { data: [{ id: "biz-1", business_name: "Tiny Toes" }], error: null });
    mockSupabase.queue("businesses", { data: [], error: null }); // doesn't own it
    mockSupabase.queue("business_members", { data: [{ business_id: "biz-1" }], error: null }); // but is a member
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0].status).toBe("own_listing");
  });

  it("P. an unrelated shopper sees a business listing as 'available', never 'own_listing'", async () => {
    mockUser = { id: "shopper-1" };
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "published", seller_type: "business", seller_profile_id: null, business_id: "biz-1", product_images: [] },
    ]);
    mockSupabase.queue("businesses_public", { data: [{ id: "biz-1", business_name: "Tiny Toes" }], error: null });
    mockSupabase.queue("businesses", { data: [], error: null });
    mockSupabase.queue("business_members", { data: [], error: null });
    const result = await getCartListings([PRODUCT_A]);
    expect(result.lines[0].status).toBe("available");
  });
});

describe("getCartListings — verification gate (D, E)", () => {
  it("D. an unauthenticated visitor gets canTransact = null (not evaluated) — /checkout itself requires sign-in first", async () => {
    mockUser = null;
    queueProducts([]);
    const result = await getCartListings([PRODUCT_A]);
    expect(result.canTransact).toBeNull();
    expect(mockSupabase.rpcMock).not.toHaveBeenCalled();
  });

  it("E. a signed-in but unverified buyer gets canTransact = false, straight from can_transact()", async () => {
    mockUser = { id: "buyer-1" };
    mockSupabase.rpcMock.mockResolvedValue({ data: false, error: null });
    queueProducts([]);
    const result = await getCartListings([PRODUCT_A]);
    expect(result.canTransact).toBe(false);
  });

  it("a signed-in, verified buyer gets canTransact = true", async () => {
    mockUser = { id: "buyer-1" };
    mockSupabase.rpcMock.mockResolvedValue({ data: true, error: null });
    queueProducts([]);
    const result = await getCartListings([PRODUCT_A]);
    expect(result.canTransact).toBe(true);
  });
});

describe("getCartListings — no fabricated financial data (I, J)", () => {
  it("I/J. a cart line never contains a delivery fee, commission, or any field beyond the public-safe set", async () => {
    queueProducts([
      { id: PRODUCT_A, title: "Cot", price_cents: 30000, currency: "ZAR", condition: "good", status: "published", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
    ]);
    mockSupabase.queue("profiles_public", { data: [{ id: "seller-1", full_name: "Alice" }], error: null });
    const result = await getCartListings([PRODUCT_A]);
    expect(Object.keys(result.lines[0]).sort()).toEqual(["condition", "currency", "id", "imageUrl", "priceCents", "sellerName", "status", "title"].sort());
  });
});

describe("getCartListings — ordering", () => {
  it("returns lines in the same order the ids were supplied, not database/query order", async () => {
    queueProducts([
      { id: PRODUCT_B, title: "Toy B", price_cents: 1000, currency: "ZAR", condition: "good", status: "published", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
      { id: PRODUCT_A, title: "Toy A", price_cents: 2000, currency: "ZAR", condition: "good", status: "published", seller_type: "parent", seller_profile_id: "seller-1", business_id: null, product_images: [] },
    ]);
    mockSupabase.queue("profiles_public", { data: [{ id: "seller-1", full_name: "Alice" }], error: null });
    const result = await getCartListings([PRODUCT_A, PRODUCT_B]);
    expect(result.lines.map((l) => l.id)).toEqual([PRODUCT_A, PRODUCT_B]);
  });
});
