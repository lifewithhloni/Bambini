import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { data: unknown; error: unknown };

function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const sessionQueues: Record<string, Result[]> = {};
const adminQueues: Record<string, Result[]> = {};
const sessionChains: Record<string, ReturnType<typeof makeChain>[]> = {};
const adminChains: Record<string, ReturnType<typeof makeChain>[]> = {};

function client(queues: Record<string, Result[]>, chains: Record<string, ReturnType<typeof makeChain>[]>) {
  return {
    from: vi.fn((table: string) => {
      const chain = makeChain(queues[table]?.shift() ?? { data: [], error: null });
      (chains[table] ??= []).push(chain);
      return chain;
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => client(sessionQueues, sessionChains)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => client(adminQueues, adminChains)) }));

const { getSavedItems } = await import("./getSavedItems");

function product(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Item ${id}`,
    price_cents: 5000,
    currency: "ZAR",
    condition: "good",
    category_id: "cat-1",
    collection_available: true,
    delivery_available: false,
    created_at: "2026-01-01T00:00:00Z",
    status,
    seller_type: "parent",
    seller_profile_id: "seller-1",
    business_id: null,
    product_images: [{ storage_path: `${id}/b.jpg`, sort_order: 1 }, { storage_path: `${id}/a.jpg`, sort_order: 0 }],
    ...overrides,
  };
}

beforeEach(() => {
  for (const q of [sessionQueues, adminQueues, sessionChains, adminChains]) for (const k of Object.keys(q)) delete (q as Record<string, unknown>)[k];
});

describe("getSavedItems", () => {
  it("P. reads the caller's OWN product_favourites rows — scoped by profile_id — newest first", async () => {
    sessionQueues.product_favourites = [{ data: [], error: null }];
    await getSavedItems("user-1");
    expect(sessionChains.product_favourites[0].eq).toHaveBeenCalledWith("profile_id", "user-1");
    expect(sessionChains.product_favourites[0].order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("returns [] with no product read when nothing is saved", async () => {
    sessionQueues.product_favourites = [{ data: [], error: null }];
    expect(await getSavedItems("user-1")).toEqual([]);
    expect(adminChains.products).toBeUndefined();
  });

  it("the current-state product read is limited to exactly the ids in the user's own favourites", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "2026-02-01" }, { product_id: "p2", created_at: "2026-01-01" }], error: null }];
    adminQueues.products = [{ data: [], error: null }];
    await getSavedItems("user-1");
    expect(adminChains.products[0].in).toHaveBeenCalledWith("id", ["p1", "p2"]);
  });

  it("I/M. a published product is available, with its CURRENT price and details from the product row", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "2026-02-01" }], error: null }];
    adminQueues.products = [{ data: [product("p1", "published", { price_cents: 7500 })], error: null }];
    sessionQueues.profiles_public = [{ data: [{ id: "seller-1", full_name: "Alice" }], error: null }];
    const [item] = await getSavedItems("user-1");
    expect(item.status).toBe("available");
    expect(item.listing).toEqual(expect.objectContaining({ id: "p1", title: "Item p1", price_cents: 7500, sellerName: "Alice", cover_image_path: "p1/a.jpg" }));
  });

  it("J. a sold product keeps its details but is marked sold", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "2026-02-01" }], error: null }];
    adminQueues.products = [{ data: [product("p1", "sold")], error: null }];
    const [item] = await getSavedItems("user-1");
    expect(item.status).toBe("sold");
    expect(item.listing?.title).toBe("Item p1");
  });

  it("K. an archived product is unavailable and reveals NO details — it may never have been public", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "2026-02-01" }], error: null }];
    adminQueues.products = [{ data: [product("p1", "archived", { title: "Secret draft-turned-archive" })], error: null }];
    const [item] = await getSavedItems("user-1");
    expect(item.status).toBe("unavailable");
    expect(item.listing).toBeNull();
    expect(JSON.stringify(item)).not.toMatch(/Secret/);
  });

  it("a draft product (e.g. a saved id someone else never published) is unavailable with no details", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "2026-02-01" }], error: null }];
    adminQueues.products = [{ data: [product("p1", "draft", { title: "Unpublished" })], error: null }];
    const [item] = await getSavedItems("user-1");
    expect(item.listing).toBeNull();
    expect(JSON.stringify(item)).not.toMatch(/Unpublished/);
  });

  it("L. a favourite whose product no longer exists is handled gracefully as removed", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "gone", created_at: "2026-02-01" }], error: null }];
    adminQueues.products = [{ data: [], error: null }];
    const [item] = await getSavedItems("user-1");
    expect(item).toEqual({ productId: "gone", savedAt: "2026-02-01", status: "removed", listing: null });
  });

  it("preserves saved order across a mix of statuses", async () => {
    sessionQueues.product_favourites = [
      { data: [{ product_id: "a", created_at: "3" }, { product_id: "b", created_at: "2" }, { product_id: "c", created_at: "1" }], error: null },
    ];
    adminQueues.products = [{ data: [product("c", "published"), product("a", "sold")], error: null }];
    const items = await getSavedItems("user-1");
    expect(items.map((i) => [i.productId, i.status])).toEqual([
      ["a", "sold"],
      ["b", "removed"],
      ["c", "available"],
    ]);
  });

  it("R. exposes no favourite counts or other users' data — each item is just the viewer's own saved entry", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "2026-02-01" }], error: null }];
    adminQueues.products = [{ data: [product("p1", "published")], error: null }];
    const [item] = await getSavedItems("user-1");
    expect(Object.keys(item).sort()).toEqual(["listing", "productId", "savedAt", "status"]);
    expect(JSON.stringify(item)).not.toMatch(/count|favourited_by|saved_by/i);
  });

  it("throws (never returns a misleading empty list) when the favourites read fails, so the route's error boundary can offer a retry", async () => {
    sessionQueues.product_favourites = [{ data: null, error: { message: "boom" } }];
    await expect(getSavedItems("user-1")).rejects.toThrow(/saved items/i);
  });

  it("throws when the current-state product read fails rather than mislabelling every item as removed", async () => {
    sessionQueues.product_favourites = [{ data: [{ product_id: "p1", created_at: "1" }], error: null }];
    adminQueues.products = [{ data: null, error: { message: "boom" } }];
    await expect(getSavedItems("user-1")).rejects.toThrow(/saved items/i);
  });
});
