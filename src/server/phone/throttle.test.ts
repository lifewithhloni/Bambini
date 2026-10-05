import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: rpcMock }) }));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({ headers: headersMock }));

const reportMock = vi.fn();
vi.mock("@/lib/monitoring/reportOperationalFailure", () => ({ reportOperationalFailure: reportMock }));

const { throttleSend, throttleVerify, peekSendCooldownSeconds, resetVerifyThrottle } = await import("./throttle");
const { PHONE_LIMITS } = await import("./types");

const allow = { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
const deny = (s: number) => ({ data: [{ allowed: false, retry_after_seconds: s }], error: null });

beforeEach(() => {
  rpcMock.mockReset();
  reportMock.mockReset();
  headersMock.mockReset();
  headersMock.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
  rpcMock.mockResolvedValue(allow);
});

describe("throttleSend", () => {
  it("applies the per-user resend cooldown and window, then a per-IP limit, recording both", async () => {
    expect(await throttleSend("user-1")).toEqual({ allowed: true });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    const [name1, args1] = rpcMock.mock.calls[0];
    expect(name1).toBe("phone_throttle_hit");
    expect(args1).toEqual({
      p_subject: "user:user-1",
      p_action: "send",
      p_max: PHONE_LIMITS.send.userMax,
      p_window_seconds: PHONE_LIMITS.send.userWindowSeconds,
      p_cooldown_seconds: PHONE_LIMITS.send.userCooldownSeconds,
      p_record: true,
    });
    const args2 = rpcMock.mock.calls[1][1];
    expect(args2.p_subject).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(args2.p_max).toBe(PHONE_LIMITS.send.ipMax);
    expect(args2.p_cooldown_seconds).toBe(0);
  });

  it("stores only a one-way hash of the client IP — never the raw address", async () => {
    await throttleSend("user-1");
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("203.0.113.9");
  });

  it("returns the user's retry delay when the per-user cooldown/limit denies, without consulting the IP limit", async () => {
    rpcMock.mockResolvedValueOnce(deny(37));
    expect(await throttleSend("user-1")).toEqual({ allowed: false, retryAfterSeconds: 37 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("denies when the per-IP limit is exceeded even though the user is under theirs", async () => {
    rpcMock.mockResolvedValueOnce(allow).mockResolvedValueOnce(deny(900));
    expect(await throttleSend("user-1")).toEqual({ allowed: false, retryAfterSeconds: 900 });
  });

  it("still enforces the per-user limit when no client IP is available", async () => {
    headersMock.mockResolvedValue(new Headers());
    expect(await throttleSend("user-1")).toEqual({ allowed: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    rpcMock.mockResolvedValueOnce(deny(10));
    expect(await throttleSend("user-1")).toEqual({ allowed: false, retryAfterSeconds: 10 });
  });

  it("never lets a client choose the subject: it is always derived from the supplied (session) user id", async () => {
    await throttleSend("session-user");
    expect(rpcMock.mock.calls[0][1].p_subject).toBe("user:session-user");
  });
});

describe("throttleVerify", () => {
  it("counts every code-check attempt per user (and per IP), with no cooldown", async () => {
    expect(await throttleVerify("user-1")).toEqual({ allowed: true });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({
      p_subject: "user:user-1",
      p_action: "verify",
      p_max: PHONE_LIMITS.verify.userMax,
      p_window_seconds: PHONE_LIMITS.verify.userWindowSeconds,
      p_cooldown_seconds: 0,
      p_record: true,
    });
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_action: "verify", p_max: PHONE_LIMITS.verify.ipMax });
  });

  it("locks out once the per-user limit is reached", async () => {
    rpcMock.mockResolvedValueOnce(deny(840));
    expect(await throttleVerify("user-1")).toEqual({ allowed: false, retryAfterSeconds: 840 });
  });
});

describe("failing closed", () => {
  it("refuses (and tells monitoring, with a static reason) when the throttle store errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const d = await throttleSend("user-1");
    expect(d.allowed).toBe(false);
    expect(reportMock).toHaveBeenCalledWith({ area: "phone_verification", reason: expect.any(String) });
  });

  it("refuses when the rpc throws", async () => {
    rpcMock.mockRejectedValue(new Error("network"));
    expect((await throttleVerify("user-1")).allowed).toBe(false);
  });
});

describe("peekSendCooldownSeconds / resetVerifyThrottle", () => {
  it("peek never records an attempt", async () => {
    rpcMock.mockResolvedValue(deny(25));
    expect(await peekSendCooldownSeconds("user-1")).toBe(25);
    expect(rpcMock.mock.calls[0][1].p_record).toBe(false);
    rpcMock.mockResolvedValue(allow);
    expect(await peekSendCooldownSeconds("user-1")).toBe(0);
  });

  it("reset clears only the verify counter for that user and never throws", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await resetVerifyThrottle("user-1");
    expect(rpcMock).toHaveBeenCalledWith("phone_throttle_reset", { p_subject: "user:user-1", p_action: "verify" });
    rpcMock.mockRejectedValue(new Error("down"));
    await expect(resetVerifyThrottle("user-1")).resolves.toBeUndefined();
  });
});
