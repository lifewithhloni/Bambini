import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockEnv: Record<string, string | undefined>;
vi.mock("@/config/env", () => ({
  getServerEnv: () => mockEnv,
}));

const { getPayFastCredentials, isPayFastSandbox } = await import("./config");
const { PayFastEnvironmentMisconfiguredError } = await import("./environmentGuard");

const VALID_CREDS = { PAYFAST_MERCHANT_ID: "10000100", PAYFAST_MERCHANT_KEY: "46f0cd694581a", PAYFAST_PASSPHRASE: "jt7NOE43FZPn" };

beforeEach(() => {
  mockEnv = { ...VALID_CREDS, PAYFAST_SANDBOX: undefined };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * getPayFastCredentials() is the codebase's existing "checked at first
 * use" boundary — this proves the Phase 15B, C-6 environment guard
 * (environmentGuard.ts) is actually wired into it, ahead of the
 * pre-existing missing-credentials check, using real Vercel deployment
 * environment values via VERCEL_ENV.
 */
describe("getPayFastCredentials — deployment-environment integration", () => {
  it("production + valid production configuration (sandbox=false, real-shaped credentials present) succeeds", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mockEnv.PAYFAST_SANDBOX = "false";
    expect(() => getPayFastCredentials()).not.toThrow();
  });

  it("production + missing credentials fails on the missing-credentials check, distinct from the environment guard", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mockEnv.PAYFAST_SANDBOX = "false";
    mockEnv.PAYFAST_MERCHANT_ID = undefined;
    expect(() => getPayFastCredentials()).toThrow(/PAYFAST_MERCHANT_ID/);
    expect(() => getPayFastCredentials()).not.toThrow(PayFastEnvironmentMisconfiguredError);
  });

  it("production left on sandbox is refused before credentials are even checked", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    // PAYFAST_SANDBOX unset -> defaults to sandbox=true, contradictory for production.
    expect(() => getPayFastCredentials()).toThrow(PayFastEnvironmentMisconfiguredError);
  });

  it("preview configured for live PayFast is refused even with otherwise-valid credentials", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    mockEnv.PAYFAST_SANDBOX = "false";
    expect(() => getPayFastCredentials()).toThrow(PayFastEnvironmentMisconfiguredError);
  });

  it("local development (no VERCEL_ENV) is unaffected by the guard", () => {
    expect(isPayFastSandbox()).toBe(true);
    expect(() => getPayFastCredentials()).not.toThrow();
  });
});
