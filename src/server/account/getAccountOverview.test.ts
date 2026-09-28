import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { data: unknown; error: unknown };

function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  return chain;
}

const queues: Record<string, Result[]> = {};
const chains: Record<string, ReturnType<typeof makeChain>[]> = {};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      const chain = makeChain(queues[table]?.shift() ?? { data: null, error: null });
      (chains[table] ??= []).push(chain);
      return chain;
    }),
  })),
}));

const getMyBusinessesMock = vi.fn();
vi.mock("@/server/business/getMyBusinesses", () => ({ getMyBusinesses: getMyBusinessesMock }));

const { getAccountOverview } = await import("./getAccountOverview");

const profileRow = { full_name: "Alice", phone: "0821234567", created_at: "2026-01-01T00:00:00Z", location_id: "loc-1" };

beforeEach(() => {
  for (const k of Object.keys(queues)) delete queues[k];
  for (const k of Object.keys(chains)) delete chains[k];
  getMyBusinessesMock.mockReset();
  getMyBusinessesMock.mockResolvedValue([]);
});

describe("getAccountOverview", () => {
  it("reads only the signed-in user's own profile row, by the id it was given", async () => {
    queues.profiles = [{ data: profileRow, error: null }];
    queues.locations = [{ data: { suburb: "Gardens", city: "Cape Town" }, error: null }];
    await getAccountOverview("user-1");
    expect(chains.profiles[0].eq).toHaveBeenCalledWith("id", "user-1");
    expect(getMyBusinessesMock).toHaveBeenCalledWith("user-1");
  });

  it("selects an explicit minimal profile column list — no role tier, verification, avatar, or standing columns", async () => {
    queues.profiles = [{ data: profileRow, error: null }];
    await getAccountOverview("user-1");
    const selected = (chains.profiles[0].select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selected.split(",").map((s) => s.trim()).sort()).toEqual(["created_at", "full_name", "location_id", "phone"]);
    expect(selected).not.toMatch(/role|verification|avatar|standing|rating/);
  });

  it("resolves the saved location as suburb/city only — never coordinates, a street address, or the row's id", async () => {
    queues.profiles = [{ data: profileRow, error: null }];
    queues.locations = [{ data: { suburb: "Gardens", city: "Cape Town" }, error: null }];
    const overview = await getAccountOverview("user-1");
    const selected = (chains.locations[0].select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selected).toBe("suburb, city");
    expect(selected).not.toMatch(/latitude|longitude|address|id/);
    expect(overview?.savedArea).toEqual({ suburb: "Gardens", city: "Cape Town" });
    expect(JSON.stringify(overview)).not.toMatch(/latitude|longitude|loc-1|location_id/);
  });

  it("savedArea is null (and no location is read at all) when the user has none saved", async () => {
    queues.profiles = [{ data: { ...profileRow, location_id: null }, error: null }];
    const overview = await getAccountOverview("user-1");
    expect(overview?.savedArea).toBeNull();
    expect(chains.locations).toBeUndefined();
  });

  it("returns null when the profile can't be read, so the page shows one honest error state", async () => {
    queues.profiles = [{ data: null, error: { message: "boom" } }];
    expect(await getAccountOverview("user-1")).toBeNull();
  });

  it("returns every business the user owns or belongs to, each distinguishable — never assuming just one", async () => {
    queues.profiles = [{ data: { ...profileRow, location_id: null }, error: null }];
    getMyBusinessesMock.mockResolvedValue([
      { id: "biz-1", businessName: "Tiny Toes", slug: "tiny-toes", verificationStatus: "verified", isOwner: true },
      { id: "biz-2", businessName: "Little Lambs", slug: "little-lambs", verificationStatus: "pending", isOwner: false },
    ]);
    const overview = await getAccountOverview("user-1");
    expect(overview?.businesses.map((b) => b.id)).toEqual(["biz-1", "biz-2"]);
    expect(overview?.businesses.map((b) => b.isOwner)).toEqual([true, false]);
  });
});
