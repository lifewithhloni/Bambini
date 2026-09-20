import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

const { searchListings } = await import("./searchListings");

beforeEach(() => {
  rpcMock.mockReset();
});

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "listing-1",
  title: "Stroller",
  price_cents: 5000,
  currency: "ZAR",
  condition: "good",
  category_id: "cat-1",
  collection_available: true,
  delivery_available: false,
  created_at: "2026-01-01T00:00:00Z",
  cover_image_path: null,
  total_count: 1,
  ...overrides,
});

describe("searchListings", () => {
  it("calls the search_products RPC with the expected argument shape", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });

    await searchListings({ q: "stroller", sort: "newest", page: 1 });

    expect(rpcMock).toHaveBeenCalledWith("search_products", {
      search_term: "stroller",
      category_ids: null,
      min_price_cents: null,
      max_price_cents: null,
      condition_filter: null,
      collection_only: false,
      delivery_only: false,
      sort_key: "newest",
      page_size: 24,
      page_offset: 0,
    });
  });

  it("passes resolved category ids through, never a raw slug", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await searchListings({ categoryIds: ["cat-a", "cat-b"], sort: "newest", page: 1 });
    const args = rpcMock.mock.calls[0][1];
    expect(args.category_ids).toEqual(["cat-a", "cat-b"]);
  });

  it("computes the correct offset for page 2+", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await searchListings({ sort: "newest", page: 3 });
    const args = rpcMock.mock.calls[0][1];
    expect(args.page_offset).toBe(48); // (3-1) * 24
  });

  it("honors a pageSize override (e.g. the homepage's smaller teaser row) for both the fetch and its pagination math", async () => {
    rpcMock.mockResolvedValue({ data: [row({ total_count: 3 })], error: null });
    const result = await searchListings({ sort: "newest", page: 1, pageSize: 8 });
    const args = rpcMock.mock.calls[0][1];
    expect(args.page_size).toBe(8);
    expect(result.pageSize).toBe(8);
  });

  it("shapes a successful response, deriving totalPages from total_count", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ id: "a", total_count: 50 }), row({ id: "b", total_count: 50 })],
      error: null,
    });

    const result = await searchListings({ sort: "newest", page: 1 });

    expect(result.listings).toHaveLength(2);
    expect(result.totalCount).toBe(50);
    expect(result.totalPages).toBe(3); // ceil(50/24)
    expect(result.pageSize).toBe(24);
    expect(result.page).toBe(1);
  });

  it("returns an empty-but-well-formed result on an RPC error, never throws", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const result = await searchListings({ sort: "newest", page: 1 });

    expect(result).toEqual({ listings: [], totalCount: 0, page: 1, pageSize: 24, totalPages: 1 });
  });

  it("returns an empty result (totalCount 0) when there are genuinely no matches, not an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await searchListings({ q: "nonexistent-item-xyz", sort: "newest", page: 1 });
    expect(result.listings).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
