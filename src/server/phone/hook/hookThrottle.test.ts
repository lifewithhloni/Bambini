import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const throttleSubjectMock = vi.fn();
vi.mock("../throttle", () => ({ throttleSubject: throttleSubjectMock }));

const { throttleHookSend, hashDestination, HOOK_LIMITS } = await import("./hookThrottle");

const SECRET = "hash-secret-SENTINEL-0123456789";
const E164 = "+27821234567";
const USER = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

beforeEach(() => {
  throttleSubjectMock.mockReset();
  throttleSubjectMock.mockResolvedValue({ allowed: true });
  vi.stubEnv("PHONE_THROTTLE_HASH_SECRET", SECRET);
  vi.stubEnv("PHONE_GLOBAL_SMS_HOURLY_LIMIT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hook-level throttle subjects and limits", () => {
  it("checks per-user (5/hour), per-destination (3/hour) and the global ceiling (default 200/hour), in that order", async () => {
    expect(await throttleHookSend(USER, E164)).toEqual({ allowed: true });

    expect(throttleSubjectMock).toHaveBeenCalledTimes(3);
    const [user, dest, global] = throttleSubjectMock.mock.calls;
    expect(user).toEqual([`huser:${USER}`, 5, 3600]);
    expect(dest[0]).toBe(`dest:${createHmac("sha256", SECRET).update(E164).digest("hex")}`);
    expect(dest.slice(1)).toEqual([3, 3600]);
    expect(global).toEqual(["global:sms", 200, 3600]);
    expect(HOOK_LIMITS).toEqual({ userMax: 5, destMax: 3, windowSeconds: 3600 });
  });

  it("uses subject namespaces that cannot collide with the 15A.1 action-level buckets (user:/ip:)", async () => {
    await throttleHookSend(USER, E164);
    for (const [subject] of throttleSubjectMock.mock.calls) {
      expect(subject).not.toMatch(/^(user|ip):/);
    }
  });

  it("per-user limit: a refused user is refused immediately and burns neither destination nor global budget", async () => {
    throttleSubjectMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1200 });
    expect(await throttleHookSend(USER, E164)).toEqual({ allowed: false, retryAfterSeconds: 1200 });
    expect(throttleSubjectMock).toHaveBeenCalledTimes(1);
  });

  it("per-destination limit: a number that has hit its cap is refused (even for a different, under-limit user) without touching the global bucket", async () => {
    throttleSubjectMock.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 });
    expect(await throttleHookSend(USER, E164)).toEqual({ allowed: false, retryAfterSeconds: 900 });
    expect(throttleSubjectMock).toHaveBeenCalledTimes(2);
  });

  it("global circuit breaker: refused when the all-users ceiling is reached", async () => {
    throttleSubjectMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 2000 });
    expect(await throttleHookSend(USER, E164)).toEqual({ allowed: false, retryAfterSeconds: 2000 });
  });

  it("the global ceiling is configurable; invalid values fall back to the safe default", async () => {
    vi.stubEnv("PHONE_GLOBAL_SMS_HOURLY_LIMIT", "50");
    await throttleHookSend(USER, E164);
    expect(throttleSubjectMock.mock.calls[2]).toEqual(["global:sms", 50, 3600]);

    for (const bad of ["0", "-5", "abc", "1.5", "100001"]) {
      throttleSubjectMock.mockClear();
      vi.stubEnv("PHONE_GLOBAL_SMS_HOURLY_LIMIT", bad);
      await throttleHookSend(USER, E164);
      expect(throttleSubjectMock.mock.calls[2]).toEqual(["global:sms", 200, 3600]);
    }
  });

  it("fails closed, without touching the store, when the hash secret is missing or too short", async () => {
    for (const bad of ["", "short"]) {
      vi.stubEnv("PHONE_THROTTLE_HASH_SECRET", bad);
      const d = await throttleHookSend(USER, E164);
      expect(d).toMatchObject({ allowed: false, misconfigured: true });
    }
    expect(throttleSubjectMock).not.toHaveBeenCalled();
  });
});

describe("destination hashing (keyed HMAC, never the number)", () => {
  it("is HMAC-SHA256 keyed by PHONE_THROTTLE_HASH_SECRET", () => {
    expect(hashDestination(E164, SECRET)).toBe(createHmac("sha256", SECRET).update(E164).digest("hex"));
    expect(hashDestination(E164, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is NOT a plain SHA-256 of the number, and changes with the key", () => {
    expect(hashDestination(E164, SECRET)).not.toBe(createHash("sha256").update(E164).digest("hex"));
    expect(hashDestination(E164, SECRET)).not.toBe(createHash("sha256").update("27821234567").digest("hex"));
    expect(hashDestination(E164, SECRET)).not.toBe(hashDestination(E164, `${SECRET}-other`));
  });

  it("is deterministic per number and distinct across numbers", () => {
    expect(hashDestination(E164, SECRET)).toBe(hashDestination(E164, SECRET));
    expect(hashDestination(E164, SECRET)).not.toBe(hashDestination("+27831234567", SECRET));
  });

  it("no throttle subject ever contains the phone number, and every subject fits the table's 128-char limit", async () => {
    await throttleHookSend(USER, E164);
    for (const [subject] of throttleSubjectMock.mock.calls) {
      expect(subject).not.toContain("27821234567");
      expect(subject).not.toContain("821234567");
      expect(subject.length).toBeLessThanOrEqual(128);
    }
  });
});
