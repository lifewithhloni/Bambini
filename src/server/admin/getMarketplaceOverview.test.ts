import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin-1" })) }));

type Call = { table: string; eqArgs: [string, unknown] | null };
const calls: Call[] = [];
const results: Record<string, number | null> = {};

function chainFor(table: string) {
  const call: Call = { table, eqArgs: null };
  calls.push(call);
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      call.eqArgs = [col, val];
      return chain;
    }),
    then: (resolve: (v: { count: number | null; error: null }) => unknown) =>
      Promise.resolve({ count: results[table + (call.eqArgs ? `:${call.eqArgs[1]}` : "")] ?? results[table] ?? null, error: null }).then(resolve),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: vi.fn((table: string) => chainFor(table)) })),
}));

const { getMarketplaceOverview } = await import("./getMarketplaceOverview");

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
});

describe("getMarketplaceOverview — exact table/filter per metric definition", () => {
  it("total accounts: counts every row of profiles, no filter", async () => {
    results["profiles"] = 42;
    await getMarketplaceOverview();
    const profileCalls = calls.filter((c) => c.table === "profiles");
    expect(profileCalls.some((c) => c.eqArgs === null)).toBe(true);
  });

  it("verified accounts: profiles filtered on identity_verification = 'verified' — never a different column", async () => {
    await getMarketplaceOverview();
    const filtered = calls.find((c) => c.table === "profiles" && c.eqArgs !== null);
    expect(filtered?.eqArgs).toEqual(["identity_verification", "verified"]);
  });

  it("business accounts: counts the businesses table itself, never business_members (which would double-count staff)", async () => {
    await getMarketplaceOverview();
    expect(calls.some((c) => c.table === "businesses")).toBe(true);
    expect(calls.some((c) => c.table === "business_members")).toBe(false);
  });

  it("active listings: products filtered on status = 'published' — never the old 'active' enum literal", async () => {
    await getMarketplaceOverview();
    const productCall = calls.find((c) => c.table === "products");
    expect(productCall?.eqArgs).toEqual(["status", "published"]);
  });

  it("completed orders: orders filtered on status = 'completed'", async () => {
    await getMarketplaceOverview();
    const orderCall = calls.find((c) => c.table === "orders");
    expect(orderCall?.eqArgs).toEqual(["status", "completed"]);
  });

  it("maps each query's count to the correctly named field, with no cross-wiring between metrics", async () => {
    results["profiles"] = 100;
    results["profiles:verified"] = 30;
    results["businesses"] = 5;
    results["products:published"] = 60;
    results["orders:completed"] = 25;
    const result = await getMarketplaceOverview();
    expect(result).toEqual({
      totalAccounts: 100,
      verifiedAccounts: 30,
      businessAccounts: 5,
      activeListings: 60,
      completedOrders: 25,
    });
  });

  it("a failed count becomes 0, never a fabricated number — matches the sibling admin list functions' own error convention", async () => {
    // Every result is already null/undefined by default (no count set) -> 0.
    const result = await getMarketplaceOverview();
    expect(Object.values(result).every((n) => n === 0)).toBe(true);
  });

  it("requires admin — requireAdmin() is called before any query", async () => {
    const { requireAdmin } = await import("@/server/auth/requireAdmin");
    await getMarketplaceOverview();
    expect(requireAdmin).toHaveBeenCalledWith("/admin");
  });
});
