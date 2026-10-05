import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

type User = { id: string; email_confirmed_at: string | null; phone_confirmed_at: string | null; phone?: string; new_phone?: string };
const requireUserMock = vi.fn<() => Promise<User>>();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

let latest: { status: string; notes: string | null } | null;
let canTransact: unknown;
const fromCalls: string[] = [];
const selectCalls: string[] = [];
const rpcMock = vi.fn(async () => ({ data: canTransact }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn((cols: string) => {
        selectCalls.push(cols);
        return chain;
      });
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: latest });
      return chain;
    }),
    rpc: rpcMock,
  })),
}));

const { getVerificationStatus } = await import("./getVerificationStatus");

const confirmedUser: User = { id: "u1", email_confirmed_at: "2026-01-01", phone_confirmed_at: null };

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue(confirmedUser);
  latest = null;
  canTransact = false;
  fromCalls.length = 0;
  selectCalls.length = 0;
});

describe("getVerificationStatus", () => {
  it("E. identity status comes from the user's own latest identity_verifications row — never from profiles", async () => {
    latest = { status: "verified", notes: null };
    const status = await getVerificationStatus();
    expect(status.identityStatus).toBe("verified");
    expect(fromCalls).toEqual(["identity_verifications"]);
    expect(fromCalls).not.toContain("profiles");
  });

  it("F. account verification (email/phone) and identity verification are independent: a confirmed email with no ID submission is still identity not_submitted", async () => {
    latest = null;
    const status = await getVerificationStatus();
    expect(status.emailConfirmed).toBe(true);
    expect(status.identityStatus).toBe("not_submitted");
  });

  it("F. and the reverse: a verified identity does not make an unconfirmed email confirmed", async () => {
    requireUserMock.mockResolvedValue({ id: "u1", email_confirmed_at: null, phone_confirmed_at: null });
    latest = { status: "verified", notes: null };
    const status = await getVerificationStatus();
    expect(status.identityStatus).toBe("verified");
    expect(status.emailConfirmed).toBe(false);
    expect(status.phoneConfirmed).toBe(false);
  });

  it("email/phone confirmation is read straight from the Auth user's *_confirmed_at, not from any stored profile flag", async () => {
    requireUserMock.mockResolvedValue({ id: "u1", email_confirmed_at: "2026-01-01", phone_confirmed_at: "2026-01-02" });
    const status = await getVerificationStatus();
    expect(status.emailConfirmed).toBe(true);
    expect(status.phoneConfirmed).toBe(true);
  });

  it("phone verification availability is configuration-driven (PHONE_VERIFICATION_ENABLED), off by default", async () => {
    expect((await getVerificationStatus()).phoneVerificationAvailable).toBe(false);
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "false");
    expect((await getVerificationStatus()).phoneVerificationAvailable).toBe(false);
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "true");
    expect((await getVerificationStatus()).phoneVerificationAvailable).toBe(true);
  });

  it("the availability flag NEVER bypasses the phone requirement: enabling it does not make an unconfirmed phone confirmed, nor canTransact true", async () => {
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "true");
    requireUserMock.mockResolvedValue({ id: "u1", email_confirmed_at: "2026-01-01", phone_confirmed_at: null });
    canTransact = false; // what can_transact() says without phone_confirmed_at
    const status = await getVerificationStatus();
    expect(status.phoneVerificationAvailable).toBe(true);
    expect(status.phoneConfirmed).toBe(false);
    expect(status.canTransact).toBe(false);
  });

  it("with the flow disabled, an unconfirmed phone stays unconfirmed and canTransact stays false (the DB gate is unchanged)", async () => {
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "false");
    requireUserMock.mockResolvedValue({ id: "u1", email_confirmed_at: "2026-01-01", phone_confirmed_at: null });
    canTransact = false;
    const status = await getVerificationStatus();
    expect(status.phoneVerificationAvailable).toBe(false);
    expect(status.phoneConfirmed).toBe(false);
    expect(status.canTransact).toBe(false);
  });

  it("the phone shown is Auth's (auth.users.phone / new_phone) — never profiles.phone, which is never selected", async () => {
    requireUserMock.mockResolvedValue({
      id: "u1",
      email_confirmed_at: "2026-01-01",
      phone_confirmed_at: "2026-01-02",
      phone: "27821234567",
      new_phone: "27831234567",
    });
    const status = await getVerificationStatus();
    expect(status.authPhone).toBe("+27821234567");
    expect(status.pendingPhone).toBe("+27831234567");
    expect(fromCalls).not.toContain("profiles");
    expect(selectCalls.join(" ")).not.toMatch(/phone/);
  });

  it("a pending (unconfirmed) number is reported as pending, never as confirmed", async () => {
    requireUserMock.mockResolvedValue({ id: "u1", email_confirmed_at: "2026-01-01", phone_confirmed_at: null, new_phone: "27821234567" });
    const status = await getVerificationStatus();
    expect(status.phoneConfirmed).toBe(false);
    expect(status.pendingPhone).toBe("+27821234567");
    expect(status.authPhone).toBeNull();
  });

  it("G. a rejected submission reports 'rejected' with the reviewer's reason (the admin form labels it 'shown to the user if rejected')", async () => {
    latest = { status: "rejected", notes: "Photo was blurry" };
    expect(await getVerificationStatus()).toEqual(expect.objectContaining({ identityStatus: "rejected", rejectionReason: "Photo was blurry" }));
  });

  it("G. notes are never returned for a pending or verified submission", async () => {
    latest = { status: "pending", notes: "internal" };
    expect((await getVerificationStatus()).rejectionReason).toBeNull();
    latest = { status: "verified", notes: "internal" };
    expect((await getVerificationStatus()).rejectionReason).toBeNull();
  });

  it("a legacy 'unverified' row is treated the same as no submission at all", async () => {
    latest = { status: "unverified", notes: null };
    expect((await getVerificationStatus()).identityStatus).toBe("not_submitted");
  });

  it("H. identity documents stay private: only status and notes are ever selected — never the ID number, document path, or reviewer", async () => {
    latest = { status: "pending", notes: null };
    await getVerificationStatus();
    expect(selectCalls).toEqual(["status, notes"]);
    expect(selectCalls.join(" ")).not.toMatch(/id_number|document|reviewed_by|storage/);
  });

  it("canTransact is exactly what the can_transact() RPC says, never re-derived here", async () => {
    canTransact = true;
    expect((await getVerificationStatus()).canTransact).toBe(true);
    canTransact = false;
    expect((await getVerificationStatus()).canTransact).toBe(false);
    canTransact = null;
    expect((await getVerificationStatus()).canTransact).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("can_transact");
  });

  it("B. requires an authenticated session before reading anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect to /login"));
    await expect(getVerificationStatus()).rejects.toThrow("redirect to /login");
    expect(fromCalls).toEqual([]);
  });
});
