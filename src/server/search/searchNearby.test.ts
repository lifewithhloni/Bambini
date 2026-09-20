import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

const { searchNearby } = await import("./searchNearby");

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
  distance_km: 3.4,
  suburb: "Gardens",
  city: "Cape Town",
  total_count: 1,
  ...overrides,
});

describe("searchNearby", () => {
  it("calls the search_nearby_products RPC with the expected argument shape", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });

    await searchNearby({ buyerLat: -33.9, buyerLng: 18.4, radiusKm: 10, sort: "distance", page: 1 });

    expect(rpcMock).toHaveBeenCalledWith("search_nearby_products", {
      buyer_lat: -33.9,
      buyer_lng: 18.4,
      radius_km: 10,
      category_ids: null,
      min_price_cents: null,
      max_price_cents: null,
      condition_filter: null,
      collection_only: false,
      delivery_only: false,
      sort_key: "distance",
      page_size: 24,
      page_offset: 0,
    });
  });

  it("passes resolved category ids through, never a raw slug", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await searchNearby({
      buyerLat: -33.9,
      buyerLng: 18.4,
      radiusKm: 10,
      categoryIds: ["cat-a", "cat-b"],
      sort: "distance",
      page: 1,
    });
    const args = rpcMock.mock.calls[0][1];
    expect(args.category_ids).toEqual(["cat-a", "cat-b"]);
  });

  it("shapes a successful response, including distance/suburb/city per listing", async () => {
    rpcMock.mockResolvedValue({ data: [row({ total_count: 1 })], error: null });

    const result = await searchNearby({ buyerLat: -33.9, buyerLng: 18.4, radiusKm: 10, sort: "distance", page: 1 });

    expect(result.listings).toEqual([
      expect.objectContaining({ id: "listing-1", distance_km: 3.4, suburb: "Gardens", city: "Cape Town" }),
    ]);
    expect(result.totalCount).toBe(1);
  });

  it("returns an empty-but-well-formed result on an RPC error, never throws", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const result = await searchNearby({ buyerLat: -33.9, buyerLng: 18.4, radiusKm: 10, sort: "distance", page: 1 });

    expect(result).toEqual({ listings: [], totalCount: 0, page: 1, pageSize: 24, totalPages: 1 });
  });

  it("returns an empty result (totalCount 0) when nothing is within range, not an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await searchNearby({ buyerLat: -33.9, buyerLng: 18.4, radiusKm: 5, sort: "distance", page: 1 });
    expect(result.listings).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
