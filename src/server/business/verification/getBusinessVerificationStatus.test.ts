import { describe, expect, it, vi } from "vitest";

let latest: { status: string; notes: string | null } | null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: latest });
      return chain;
    },
  })),
}));

const { getBusinessVerificationStatus } = await import("./getBusinessVerificationStatus");

// The admin review form labels this field "Review notes (shown to the
// business if rejected)" — the reviewer writes it knowing a rejected
// business will read it. These lock the other half of that contract: it is
// ONLY ever returned for a rejection, never for pending/verified.
describe("getBusinessVerificationStatus — reviewer notes reach the business only on rejection", () => {
  it("returns the notes for a rejected submission", async () => {
    latest = { status: "rejected", notes: "Registration number unreadable" };
    expect(await getBusinessVerificationStatus("biz-1")).toEqual({ status: "rejected", rejectionReason: "Registration number unreadable" });
  });

  it("never returns notes for a verified submission", async () => {
    latest = { status: "verified", notes: "internal: checked CIPC" };
    expect((await getBusinessVerificationStatus("biz-1")).rejectionReason).toBeNull();
  });

  it("never returns notes for a pending submission", async () => {
    latest = { status: "pending", notes: "internal" };
    expect((await getBusinessVerificationStatus("biz-1")).rejectionReason).toBeNull();
  });

  it("reports not_submitted when there is no submission", async () => {
    latest = null;
    expect(await getBusinessVerificationStatus("biz-1")).toEqual({ status: "not_submitted", rejectionReason: null });
  });
});
