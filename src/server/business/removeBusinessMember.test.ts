import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

let deleteResult: { data: unknown; error: unknown };
const eqCalls: [string, string][] = [];
const deleteChain: Record<string, unknown> = {};
deleteChain.eq = vi.fn((col: string, val: string) => {
  eqCalls.push([col, val]);
  return deleteChain;
});
deleteChain.select = vi.fn(() => Promise.resolve(deleteResult));
const fromMock = vi.fn(() => ({ delete: vi.fn(() => deleteChain) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: fromMock })) }));

const { removeBusinessMember } = await import("./actions");

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "owner-1" });
  revalidatePathMock.mockClear();
  fromMock.mockClear();
  eqCalls.length = 0;
  deleteResult = { data: [{ profile_id: "m1" }], error: null };
});

describe("removeBusinessMember", () => {
  it("requires authentication before touching the database", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect"));
    await expect(removeBusinessMember("biz-1", "m1")).rejects.toThrow("redirect");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("deletes only the one membership row identified by BOTH business id and profile id", async () => {
    await removeBusinessMember("biz-1", "m1");
    expect(fromMock).toHaveBeenCalledWith("business_members");
    expect(eqCalls).toEqual([
      ["business_id", "biz-1"],
      ["profile_id", "m1"],
    ]);
  });

  it("a non-owner's delete matches 0 rows under RLS — reported as a plain failure, never as success", async () => {
    deleteResult = { data: [], error: null };
    expect(await removeBusinessMember("biz-1", "m1")).toEqual({ error: expect.any(String) });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns a safe error, never raw database text, when the delete itself errors", async () => {
    deleteResult = { data: null, error: { message: "permission denied for table business_members" } };
    const result = await removeBusinessMember("biz-1", "m1");
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/permission denied/i);
  });

  it("revalidates the team page on success", async () => {
    expect(await removeBusinessMember("biz-1", "m1")).toBeNull();
    expect(revalidatePathMock).toHaveBeenCalledWith("/account/business/biz-1/team");
  });
});
