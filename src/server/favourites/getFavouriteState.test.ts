import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getOptionalUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ getOptionalUser: getOptionalUserMock }));

let result: { data: unknown; error: unknown };
const eqCalls: [string, unknown][] = [];
const inCalls: [string, unknown][] = [];
const fromCalls: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        eqCalls.push([c, v]);
        return chain;
      };
      chain.in = (c: string, v: unknown) => {
        inCalls.push([c, v]);
        return Promise.resolve(result);
      };
      return chain;
    }),
  })),
}));

const { getFavouriteState } = await import("./getFavouriteState");

beforeEach(() => {
  getOptionalUserMock.mockReset();
  getOptionalUserMock.mockResolvedValue({ id: "user-1" });
  result = { data: [], error: null };
  eqCalls.length = 0;
  inCalls.length = 0;
  fromCalls.length = 0;
});

describe("getFavouriteState", () => {
  it("an anonymous visitor gets signedIn: false and no database read at all", async () => {
    getOptionalUserMock.mockResolvedValue(null);
    const state = await getFavouriteState(["p1"]);
    expect(state.signedIn).toBe(false);
    expect(state.savedIds.size).toBe(0);
    expect(fromCalls).toEqual([]);
  });

  it("reads only the viewer's own rows, for just the ids on screen, in one batched query", async () => {
    result = { data: [{ product_id: "p1" }], error: null };
    const state = await getFavouriteState(["p1", "p2"]);
    expect(fromCalls).toEqual(["product_favourites"]);
    expect(eqCalls).toEqual([["profile_id", "user-1"]]);
    expect(inCalls).toEqual([["product_id", ["p1", "p2"]]]);
    expect([...state.savedIds]).toEqual(["p1"]);
    expect(state.signedIn).toBe(true);
  });

  it("returns a set of the viewer's own saved ids — no counts, no other users", async () => {
    const state = await getFavouriteState(["p1"]);
    expect(Object.keys(state).sort()).toEqual(["savedIds", "signedIn"]);
  });

  it("no ids on screen means no query", async () => {
    const state = await getFavouriteState([]);
    expect(state.signedIn).toBe(true);
    expect(fromCalls).toEqual([]);
  });

  it("a failed read degrades to 'nothing shown as saved' instead of breaking the browse page", async () => {
    result = { data: null, error: { message: "boom" } };
    const state = await getFavouriteState(["p1"]);
    expect(state.signedIn).toBe(true);
    expect(state.savedIds.size).toBe(0);
  });
});
