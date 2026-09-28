import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPayFastEnvironmentSafety, PayFastEnvironmentMisconfiguredError } from "./environmentGuard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertPayFastEnvironmentSafety — Phase 15B, C-6", () => {
  it("production + valid production configuration (sandbox=false) passes", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => assertPayFastEnvironmentSafety(false)).not.toThrow();
  });

  it("production + sandbox left on (contradictory config) refuses, distinctly from a missing-credentials error", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => assertPayFastEnvironmentSafety(true)).toThrow(PayFastEnvironmentMisconfiguredError);
    expect(() => assertPayFastEnvironmentSafety(true)).toThrow(/production/i);
  });

  it("preview + sandbox configuration passes", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => assertPayFastEnvironmentSafety(true)).not.toThrow();
  });

  it("preview + attempted live configuration (sandbox=false) fails safely rather than risking a live transaction", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => assertPayFastEnvironmentSafety(false)).toThrow(PayFastEnvironmentMisconfiguredError);
    expect(() => assertPayFastEnvironmentSafety(false)).toThrow(/preview/i);
  });

  it("development/local (no VERCEL_ENV) never throws, regardless of sandbox value — local development stays easy", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(() => assertPayFastEnvironmentSafety(true)).not.toThrow();
    expect(() => assertPayFastEnvironmentSafety(false)).not.toThrow();
  });

  it("Vercel's own 'development' environment value is also left alone", () => {
    vi.stubEnv("VERCEL_ENV", "development");
    expect(() => assertPayFastEnvironmentSafety(true)).not.toThrow();
    expect(() => assertPayFastEnvironmentSafety(false)).not.toThrow();
  });
});
