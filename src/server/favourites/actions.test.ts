import { describe, expect, it, vi, beforeEach } from "vitest";

const getOptionalUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ getOptionalUser: getOptionalUserMock }));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

let productResult: { data: unknown };
let upsertResult: { error: unknown };
let deleteResult: { error: unknown };
const upsertMock = vi.fn(async () => upsertResult);
const deleteEqCalls: [string, string][] = [];
const productEqCalls: [string, string][] = [];
const fromCalls: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (table === "products") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (c: string, v: string) => {
          productEqCalls.push([c, v]);
          return chain;
        };
        chain.maybeSingle = () => Promise.resolve(productResult);
        return chain;
      }
      return {
        upsert: upsertMock,
        delete: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = (c: string, v: string) => {
            deleteEqCalls.push([c, v]);
            return deleteEqCalls.length % 2 === 0 ? Promise.resolve(deleteResult) : chain;
          };
          return chain;
        },
      };
    }),
  })),
}));

const { saveListing, unsaveListing } = await import("./actions");

const PRODUCT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  getOptionalUserMock.mockReset();
  getOptionalUserMock.mockResolvedValue({ id: "user-1" });
  revalidatePathMock.mockClear();
  upsertMock.mockClear();
  deleteEqCalls.length = 0;
  productEqCalls.length = 0;
  fromCalls.length = 0;
  productResult = { data: { id: PRODUCT } };
  upsertResult = { error: null };
  deleteResult = { error: null };
});

describe("saveListing", () => {
  it("E. an anonymous visitor cannot save — they're told to sign in, and nothing is read or written", async () => {
    getOptionalUserMock.mockResolvedValue(null);
    expect(await saveListing(PRODUCT)).toEqual({ error: expect.any(String), authRequired: true });
    expect(fromCalls).toEqual([]);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("A/N. saves for the SERVER-resolved user — the action takes only a product id, so a client can never name the owner", async () => {
    expect(saveListing.length).toBe(1);
    expect(await saveListing(PRODUCT)).toEqual({ saved: true });
    expect(upsertMock).toHaveBeenCalledWith({ profile_id: "user-1", product_id: PRODUCT }, expect.anything());
  });

  it("C. a repeat save is a database-level no-op (ON CONFLICT DO NOTHING via ignoreDuplicates) and still reports saved", async () => {
    await saveListing(PRODUCT);
    expect(upsertMock).toHaveBeenCalledWith(expect.anything(), { onConflict: "profile_id,product_id", ignoreDuplicates: true });
    expect(await saveListing(PRODUCT)).toEqual({ saved: true });
  });

  it("H. a listing that isn't currently published-and-visible cannot be saved", async () => {
    productResult = { data: null };
    expect(await saveListing(PRODUCT)).toEqual({ error: expect.any(String) });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(productEqCalls).toContainEqual(["status", "published"]);
  });

  it("H. a malformed product id is rejected before any database access", async () => {
    expect(await saveListing("not-a-uuid")).toEqual({ error: expect.any(String) });
    expect(fromCalls).toEqual([]);
  });

  it("returns a safe generic error, never raw database text, when the write fails", async () => {
    upsertResult = { error: { message: "permission denied for table product_favourites" } };
    const result = await saveListing(PRODUCT);
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/permission denied/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("revalidates the saved-items page on success", async () => {
    await saveListing(PRODUCT);
    expect(revalidatePathMock).toHaveBeenCalledWith("/account/saved");
  });
});

describe("unsaveListing", () => {
  it("an anonymous visitor cannot manage saved items", async () => {
    getOptionalUserMock.mockResolvedValue(null);
    expect(await unsaveListing(PRODUCT)).toEqual({ error: expect.any(String), authRequired: true });
    expect(fromCalls).toEqual([]);
  });

  it("B/G. deletes only the SERVER-resolved user's own row, filtered by both profile_id and product_id", async () => {
    expect(unsaveListing.length).toBe(1);
    expect(await unsaveListing(PRODUCT)).toEqual({ saved: false });
    expect(deleteEqCalls).toEqual([
      ["profile_id", "user-1"],
      ["product_id", PRODUCT],
    ]);
  });

  it("D. removing something that isn't saved is safe — zero rows affected is not an error", async () => {
    expect(await unsaveListing(PRODUCT)).toEqual({ saved: false });
    expect(await unsaveListing(PRODUCT)).toEqual({ saved: false });
  });

  it("works regardless of the listing's current status — no product read at all, so an unavailable item can always be cleared", async () => {
    await unsaveListing(PRODUCT);
    expect(fromCalls).not.toContain("products");
  });

  it("returns a safe generic error when the delete fails", async () => {
    deleteResult = { error: { message: "boom" } };
    const result = await unsaveListing(PRODUCT);
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/boom/);
  });
});
