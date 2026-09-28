import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const queues: Record<string, QueuedResult[]> = {};
const chains: Record<string, ReturnType<typeof makeChain>[]> = {};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      const chain = makeChain(queues[table]?.shift() ?? { data: [], error: null });
      (chains[table] ??= []).push(chain);
      return chain;
    }),
  })),
}));

const { getBusinessMembers } = await import("./getBusinessMembers");

beforeEach(() => {
  for (const k of Object.keys(queues)) delete queues[k];
  for (const k of Object.keys(chains)) delete chains[k];
});

describe("getBusinessMembers", () => {
  it("returns [] when the business has no team members or the read fails", async () => {
    queues.business_members = [{ data: [], error: null }];
    expect(await getBusinessMembers("biz-1")).toEqual([]);
    queues.business_members = [{ data: null, error: { message: "boom" } }];
    expect(await getBusinessMembers("biz-1")).toEqual([]);
  });

  it("scopes to one business and never selects business_members.role — it is not a permission tier", async () => {
    queues.business_members = [{ data: [], error: null }];
    await getBusinessMembers("biz-1");
    expect(chains.business_members[0].eq).toHaveBeenCalledWith("business_id", "biz-1");
    const selectArg = (chains.business_members[0].select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).not.toMatch(/role/);
  });

  it("resolves display names from profiles_public only, falling back to a neutral label", async () => {
    queues.business_members = [
      {
        data: [
          { profile_id: "u1", created_at: "2026-01-01" },
          { profile_id: "u2", created_at: "2026-01-02" },
        ],
        error: null,
      },
    ];
    queues.profiles_public = [{ data: [{ id: "u1", full_name: "Alice" }], error: null }];
    const members = await getBusinessMembers("biz-1");
    expect(members).toEqual([
      { profileId: "u1", displayName: "Alice" },
      { profileId: "u2", displayName: "Team member" },
    ]);
    expect(Object.keys(members[0]).sort()).toEqual(["displayName", "profileId"]);
  });
});
