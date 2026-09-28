import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

let result: QueuedResult;
let lastChain: ReturnType<typeof makeChain>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn(() => {
      lastChain = makeChain(result);
      return lastChain;
    }),
  })),
}));

const { getBusinessListings } = await import("./getBusinessListings");

beforeEach(() => {
  result = { data: [], error: null };
});

describe("getBusinessListings", () => {
  it("scopes the read to the one business by id, never returning another business's or personal listings", async () => {
    await getBusinessListings("biz-1");
    expect(lastChain.eq).toHaveBeenCalledWith("business_id", "biz-1");
  });

  it("returns [] (never throws) on a query error", async () => {
    result = { data: null, error: { message: "boom" } };
    expect(await getBusinessListings("biz-1")).toEqual([]);
  });

  it("shapes listings with the lowest-sort-order image as the cover, and never selects any owner/member field", async () => {
    result = {
      data: [
        {
          id: "p1",
          title: "Cot",
          price_cents: 80000,
          status: "published",
          condition: "good",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          seller_type: "business",
          product_images: [
            { storage_path: "p1/b.jpg", sort_order: 1 },
            { storage_path: "p1/a.jpg", sort_order: 0 },
          ],
        },
      ],
      error: null,
    };
    const listings = await getBusinessListings("biz-1");
    expect(listings).toEqual([
      expect.objectContaining({ id: "p1", status: "published", seller_type: "business", cover_image_path: "p1/a.jpg" }),
    ]);
    const selectArg = (lastChain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).not.toMatch(/seller_profile_id|business_id|owner/);
  });
});
