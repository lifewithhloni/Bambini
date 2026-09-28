import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { data: unknown };
const results: Record<string, Result> = {};
const fromCalls: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve(results[table] ?? { data: null });
      return chain;
    }),
  })),
}));

const { viewerIsOrderSeller } = await import("./viewerIsOrderSeller");

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  fromCalls.length = 0;
});

describe("viewerIsOrderSeller — the personal /sell/orders/[id] authorization, unchanged", () => {
  it("the order's parent seller is the seller, with no business lookups at all", async () => {
    expect(await viewerIsOrderSeller({ seller_profile_id: "u1", business_id: null }, "u1")).toBe(true);
    expect(fromCalls).toEqual([]);
  });

  it("a different user on a personal order (no business) is not the seller — including the buyer", async () => {
    expect(await viewerIsOrderSeller({ seller_profile_id: "u1", business_id: null }, "buyer")).toBe(false);
  });

  it("the business owner is a seller of a business order", async () => {
    results.businesses = { data: { id: "biz-1" } };
    expect(await viewerIsOrderSeller({ seller_profile_id: null, business_id: "biz-1" }, "owner")).toBe(true);
  });

  it("any business member is a seller of a business order", async () => {
    results.business_members = { data: { business_id: "biz-1" } };
    expect(await viewerIsOrderSeller({ seller_profile_id: null, business_id: "biz-1" }, "staff")).toBe(true);
  });

  it("a user who is neither owner nor member of the order's business is not the seller", async () => {
    expect(await viewerIsOrderSeller({ seller_profile_id: null, business_id: "biz-1" }, "stranger")).toBe(false);
  });
});
