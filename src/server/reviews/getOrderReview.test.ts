import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let result: { data: unknown };
const selectMock = vi.fn();
const eqMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      fromMock(table);
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        selectMock(cols);
        return chain;
      };
      chain.eq = (col: string, val: string) => {
        eqMock(col, val);
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(result);
      return chain;
    },
  })),
}));

const { getOrderReview } = await import("./getOrderReview");

beforeEach(() => {
  for (const m of [selectMock, eqMock, fromMock]) m.mockReset();
  result = { data: null };
});

describe("getOrderReview", () => {
  it("returns null when the order has no review (or it isn't the caller's — RLS returns no row)", async () => {
    expect(await getOrderReview("order-1")).toBeNull();
  });

  it("maps the review's three display fields", async () => {
    result = { data: { rating: 4, comment: "Nice", created_at: "2026-10-01T10:00:00Z" } };
    expect(await getOrderReview("order-1")).toEqual({ rating: 4, comment: "Nice", createdAt: "2026-10-01T10:00:00Z" });
  });

  it("reads the base table by order id, selecting only rating/comment/created_at — never reviewer/seller/order ids or the reserved columns", async () => {
    await getOrderReview("order-1");
    expect(fromMock).toHaveBeenCalledWith("reviews");
    expect(eqMock).toHaveBeenCalledWith("order_id", "order-1");
    expect(selectMock).toHaveBeenCalledWith("rating, comment, created_at");
    expect(selectMock.mock.calls[0][0]).not.toMatch(/reviewer_id|seller|business_id|hidden_at|seller_response|\*/);
  });
});
