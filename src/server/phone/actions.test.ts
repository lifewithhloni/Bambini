import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

const updateUserMock = vi.fn();
const verifyOtpMock = vi.fn();
const resendMock = vi.fn();
const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { updateUser: updateUserMock, verifyOtp: verifyOtpMock, resend: resendMock, getUser: getUserMock },
  })),
}));

const throttleSendMock = vi.fn();
const throttleVerifyMock = vi.fn();
const resetVerifyThrottleMock = vi.fn();
vi.mock("./throttle", () => ({
  throttleSend: throttleSendMock,
  throttleVerify: throttleVerifyMock,
  resetVerifyThrottle: resetVerifyThrottleMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const reportMock = vi.fn();
vi.mock("@/lib/monitoring/reportOperationalFailure", () => ({ reportOperationalFailure: reportMock }));

const { startPhoneVerification, confirmPhoneVerification, resendPhoneVerification } = await import("./actions");
const { PHONE_MESSAGES } = await import("./types");

const E164 = "+27821234567";
const OTP = "654321";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** A Supabase Auth user as getUser() returns it (phone stored WITHOUT the "+"). */
function authUser(overrides: Record<string, unknown> = {}) {
  return { id: "user-1", email: "a@example.com", phone: undefined, phone_confirmed_at: undefined, new_phone: undefined, ...overrides };
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.stubEnv("PHONE_VERIFICATION_ENABLED", "true");
  for (const m of [requireUserMock, updateUserMock, verifyOtpMock, resendMock, getUserMock, throttleSendMock, throttleVerifyMock, resetVerifyThrottleMock, revalidatePathMock, reportMock]) {
    m.mockReset();
  }
  requireUserMock.mockResolvedValue(authUser());
  throttleSendMock.mockResolvedValue({ allowed: true });
  throttleVerifyMock.mockResolvedValue({ allowed: true });
  updateUserMock.mockResolvedValue({ data: {}, error: null });
  resendMock.mockResolvedValue({ data: {}, error: null });
  verifyOtpMock.mockResolvedValue({ data: {}, error: null });
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  vi.unstubAllEnvs();
});

function everythingLogged(): string {
  return JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
}

describe("startPhoneVerification", () => {
  it("normalizes the number to canonical +27 E.164 BEFORE calling Supabase Auth", async () => {
    for (const input of ["082 123 4567", "0821234567", "27821234567", "+27 82 123 4567", "0027 82 123 4567"]) {
      updateUserMock.mockClear();
      const result = await startPhoneVerification(null, formData({ phone: input }));
      expect(result?.status).toBe("code_sent");
      expect(updateUserMock).toHaveBeenCalledTimes(1);
      expect(updateUserMock).toHaveBeenCalledWith({ phone: E164 });
    }
  });

  it("never reaches Supabase with a non-South-African, landline or malformed number", async () => {
    for (const input of ["+14155552671", "0112345678", "0801234567", "082123", "abc", "", "0821234567'; drop table x;--"]) {
      const result = await startPhoneVerification(null, formData({ phone: input }));
      expect(result).toMatchObject({ status: "error" });
    }
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(throttleSendMock).not.toHaveBeenCalled();
  });

  it("acts only on the server-verified session user — a client-supplied user_id/id is never read or forwarded", async () => {
    await startPhoneVerification(null, formData({ phone: "0821234567", user_id: "victim-id", userId: "victim-id", id: "victim-id" }));
    expect(throttleSendMock).toHaveBeenCalledWith("user-1");
    // updateUser carries only the phone — there is no way to address another account.
    expect(updateUserMock).toHaveBeenCalledWith({ phone: E164 });
    expect(JSON.stringify(updateUserMock.mock.calls)).not.toContain("victim-id");
  });

  it("changing number requires re-verification: a verified user switching to a NEW number gets a code sent (Auth keeps the old number until it is confirmed)", async () => {
    requireUserMock.mockResolvedValue(authUser({ phone: "27829999999", phone_confirmed_at: "2026-01-01T00:00:00Z" }));
    const result = await startPhoneVerification(null, formData({ phone: "0821234567" }));
    expect(result?.status).toBe("code_sent");
    expect(updateUserMock).toHaveBeenCalledWith({ phone: E164 });
    // No other write path exists: the action only ever calls auth.updateUser.
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("re-submitting the user's already-verified number is a no-op, not a new SMS", async () => {
    requireUserMock.mockResolvedValue(authUser({ phone: "27821234567", phone_confirmed_at: "2026-01-01T00:00:00Z" }));
    const result = await startPhoneVerification(null, formData({ phone: "082 123 4567" }));
    expect(result?.status).toBe("already_verified");
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(throttleSendMock).not.toHaveBeenCalled();
  });

  it("a phone-already-registered error becomes the SAME generic message as any other send failure — never reveals the number is taken, never echoes it", async () => {
    updateUserMock.mockResolvedValue({ data: {}, error: { code: "phone_exists", status: 422, message: `A user with phone ${E164} has already been registered` } });
    const taken = await startPhoneVerification(null, formData({ phone: "0821234567" }));

    updateUserMock.mockResolvedValue({ data: {}, error: { code: "validation_failed", status: 422, message: "some other failure" } });
    const other = await startPhoneVerification(null, formData({ phone: "0821234567" }));

    expect(taken).toEqual({ status: "error", message: PHONE_MESSAGES.sendFailed });
    expect(taken).toEqual(other);
    expect(JSON.stringify(taken)).not.toMatch(/registered|exists|taken|27821234567/i);
  });

  it("maps an Auth-side SMS rate limit to a rate-limited state (no raw error text)", async () => {
    updateUserMock.mockResolvedValue({ data: {}, error: { code: "over_sms_send_rate_limit", status: 429, message: "SMS rate limit exceeded for +27821234567" } });
    const result = await startPhoneVerification(null, formData({ phone: "0821234567" }));
    expect(result).toMatchObject({ status: "rate_limited", message: PHONE_MESSAGES.rateLimited });
    expect(JSON.stringify(result)).not.toContain("27821234567");
  });

  it("reports a disabled/failed SMS provider as 'unavailable' and tells monitoring with a static reason only", async () => {
    updateUserMock.mockResolvedValue({ data: {}, error: { code: "phone_provider_disabled", status: 422, message: `Unsupported phone provider for ${E164}` } });
    const result = await startPhoneVerification(null, formData({ phone: "0821234567" }));
    expect(result).toEqual({ status: "unavailable", message: PHONE_MESSAGES.unavailable });
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(reportMock.mock.calls)).not.toContain("27821234567");
  });

  it("resend cooldown: while the per-user cooldown is active it refuses WITHOUT calling Auth, and reports the wait", async () => {
    throttleSendMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const result = await startPhoneVerification(null, formData({ phone: "0821234567" }));
    expect(result).toMatchObject({ status: "rate_limited", retryAfterSeconds: 42 });
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("resendPhoneVerification", () => {
  it("resends to the pending number Auth holds for THIS user — the client supplies no phone", async () => {
    requireUserMock.mockResolvedValue(authUser({ new_phone: "27821234567" }));
    const result = await resendPhoneVerification(null);
    expect(result?.status).toBe("code_sent");
    expect(resendMock).toHaveBeenCalledWith({ type: "phone_change", phone: E164 });
  });

  it("enforces the resend cooldown before touching Auth", async () => {
    requireUserMock.mockResolvedValue(authUser({ new_phone: "27821234567" }));
    throttleSendMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const result = await resendPhoneVerification(null);
    expect(result).toMatchObject({ status: "rate_limited", retryAfterSeconds: 30 });
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("refuses when no number is pending", async () => {
    const result = await resendPhoneVerification(null);
    expect(result).toEqual({ status: "error", message: PHONE_MESSAGES.noPending });
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("maps provider errors without leaking them", async () => {
    requireUserMock.mockResolvedValue(authUser({ new_phone: "27821234567" }));
    resendMock.mockResolvedValue({ data: {}, error: { code: "sms_send_failed", message: "Twilio 21608 account sid AC123 for +27821234567" } });
    const result = await resendPhoneVerification(null);
    expect(result).toEqual({ status: "unavailable", message: PHONE_MESSAGES.unavailable });
    expect(JSON.stringify(result)).not.toMatch(/Twilio|AC123|27821234567/);
  });
});

describe("confirmPhoneVerification", () => {
  const pendingUser = () => authUser({ new_phone: "27821234567" });

  it("verifies with type 'phone_change' against the PENDING number Auth holds — a client-supplied phone/user id is ignored", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    getUserMock.mockResolvedValue({ data: { user: authUser({ phone: "27821234567", phone_confirmed_at: "2026-10-05T10:00:00Z" }) } });

    await confirmPhoneVerification(null, formData({ code: OTP, phone: "+27839999999", user_id: "victim-id" }));

    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(verifyOtpMock).toHaveBeenCalledWith({ phone: E164, token: OTP, type: "phone_change" });
    expect(JSON.stringify(verifyOtpMock.mock.calls)).not.toContain("27839999999");
    expect(JSON.stringify(verifyOtpMock.mock.calls)).not.toContain("victim-id");
    expect(throttleVerifyMock).toHaveBeenCalledWith("user-1");
  });

  it("reports verified only after re-reading Auth and seeing phone_confirmed_at for that number", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    getUserMock.mockResolvedValue({ data: { user: authUser({ phone: "27821234567", phone_confirmed_at: "2026-10-05T10:00:00Z" }) } });
    const result = await confirmPhoneVerification(null, formData({ code: OTP }));
    expect(result).toEqual({ status: "verified", message: PHONE_MESSAGES.verified });
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(resetVerifyThrottleMock).toHaveBeenCalledWith("user-1");
  });

  it("does NOT claim verified if verifyOtp returned no error but Auth still shows no confirmed phone", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    getUserMock.mockResolvedValue({ data: { user: authUser({ phone: undefined, phone_confirmed_at: undefined, new_phone: "27821234567" }) } });
    const result = await confirmPhoneVerification(null, formData({ code: OTP }));
    expect(result?.status).toBe("error");
    expect(result?.status).not.toBe("verified");
    expect(resetVerifyThrottleMock).not.toHaveBeenCalled();
  });

  it("does NOT claim verified if Auth's confirmed phone is a different number than the one pending", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    getUserMock.mockResolvedValue({ data: { user: authUser({ phone: "27839999999", phone_confirmed_at: "2026-10-05T10:00:00Z" }) } });
    const result = await confirmPhoneVerification(null, formData({ code: OTP }));
    expect(result?.status).toBe("error");
  });

  it("an incorrect or expired code is one generic message; the attempt still counted", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    verifyOtpMock.mockResolvedValue({ data: {}, error: { code: "otp_expired", status: 403, message: "Token has expired or is invalid" } });
    const result = await confirmPhoneVerification(null, formData({ code: OTP }));
    expect(result).toEqual({ status: "invalid_code", message: PHONE_MESSAGES.invalidCode });
    expect(throttleVerifyMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed code without calling Auth or spending an attempt", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    for (const code of ["", "12345", "1234567", "abcdef", "12 34", "<script>"]) {
      const result = await confirmPhoneVerification(null, formData({ code }));
      expect(result?.status).toBe("invalid_code");
    }
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(throttleVerifyMock).not.toHaveBeenCalled();
  });

  it("verification attempt protection: once the per-user limit is hit it locks out WITHOUT calling Auth", async () => {
    requireUserMock.mockResolvedValue(pendingUser());
    throttleVerifyMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });
    const result = await confirmPhoneVerification(null, formData({ code: OTP }));
    expect(result).toMatchObject({ status: "rate_limited", retryAfterSeconds: 600 });
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("refuses when no number is pending", async () => {
    const result = await confirmPhoneVerification(null, formData({ code: OTP }));
    expect(result).toEqual({ status: "error", message: PHONE_MESSAGES.noPending });
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});

describe("OTP codes and phone numbers are never logged or returned", () => {
  it("across every action and error path, no console output contains the OTP or any phone number, and no result echoes the OTP", async () => {
    const results: unknown[] = [];
    const pending = authUser({ new_phone: "27821234567" });

    // start: success + each error kind
    results.push(await startPhoneVerification(null, formData({ phone: "082 123 4567" })));
    for (const code of ["phone_exists", "over_sms_send_rate_limit", "phone_provider_disabled", "sms_send_failed", "validation_failed"]) {
      updateUserMock.mockResolvedValue({ data: {}, error: { code, status: 422, message: `boom for ${E164} / 0821234567 / ${OTP}` } });
      results.push(await startPhoneVerification(null, formData({ phone: "082 123 4567" })));
    }

    // confirm: success, wrong code, verify error kinds, post-verify mismatch
    requireUserMock.mockResolvedValue(pending);
    verifyOtpMock.mockResolvedValue({ data: {}, error: null });
    getUserMock.mockResolvedValue({ data: { user: authUser({ phone: "27821234567", phone_confirmed_at: "2026-10-05T10:00:00Z" }) } });
    results.push(await confirmPhoneVerification(null, formData({ code: OTP })));
    for (const code of ["otp_expired", "over_request_rate_limit", "sms_send_failed", "unexpected_failure"]) {
      verifyOtpMock.mockResolvedValue({ data: {}, error: { code, status: 400, message: `bad token ${OTP} for ${E164}` } });
      results.push(await confirmPhoneVerification(null, formData({ code: OTP })));
    }

    // resend: success + error
    results.push(await resendPhoneVerification(null));
    resendMock.mockResolvedValue({ data: {}, error: { code: "unexpected_failure", message: `x ${E164}` } });
    results.push(await resendPhoneVerification(null));

    const logged = everythingLogged();
    expect(logged).not.toContain(OTP);
    expect(logged).not.toMatch(/27821234567|0821234567|082 123 4567/);

    const returned = JSON.stringify(results);
    expect(returned).not.toContain(OTP);
    expect(returned).not.toMatch(/27821234567|0821234567|082 123 4567/);

    // What monitoring is told is static text too.
    expect(JSON.stringify(reportMock.mock.calls)).not.toContain(OTP);
    expect(JSON.stringify(reportMock.mock.calls)).not.toMatch(/27821234567|0821234567/);
  });
});

describe("disabled / unavailable mode (PHONE_VERIFICATION_ENABLED not 'true')", () => {
  it.each([undefined, "", "false", "1", "TRUE", "yes"])("value %j: every action refuses and never touches Auth or the throttle", async (value) => {
    if (value === undefined) vi.stubEnv("PHONE_VERIFICATION_ENABLED", undefined as unknown as string);
    else vi.stubEnv("PHONE_VERIFICATION_ENABLED", value);
    requireUserMock.mockResolvedValue(authUser({ new_phone: "27821234567" }));

    const results = [
      await startPhoneVerification(null, formData({ phone: "0821234567" })),
      await confirmPhoneVerification(null, formData({ code: OTP })),
      await resendPhoneVerification(null),
    ];

    for (const r of results) expect(r).toEqual({ status: "unavailable", message: PHONE_MESSAGES.unavailable });
    for (const m of [updateUserMock, verifyOtpMock, resendMock, getUserMock, throttleSendMock, throttleVerifyMock]) {
      expect(m).not.toHaveBeenCalled();
    }
  });
});

describe("no verification bypass exists in the phone module", () => {
  it("actions never write phone_confirmed_at or any table — they only call the three Auth APIs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname);
    const sources = fs
      .readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
    const all = sources.join("\n");

    // phone_confirmed_at may be READ off the Auth user, never assigned/written.
    expect(all).not.toMatch(/phone_confirmed_at\s*:/);
    expect(all).not.toMatch(/phone_confirmed_at\s*=[^=]/);
    expect(all).not.toMatch(/\.from\(\s*["']profiles["']\s*\)/);
    expect(all).not.toMatch(/\.from\(\s*["']auth\./);
    expect(all).not.toMatch(/admin\.auth|auth\.admin|updateUserById/);
    expect(all).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});
