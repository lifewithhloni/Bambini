import { describe, expect, it } from "vitest";
import { isQuoteExpired } from "./quoteExpiry";

describe("isQuoteExpired", () => {
  it("returns false for a quote that expires in the future", () => {
    expect(isQuoteExpired("2026-01-01T00:10:00.000Z", new Date("2026-01-01T00:00:00.000Z").getTime())).toBe(false);
  });

  it("returns true for a quote whose expiry has already passed", () => {
    expect(isQuoteExpired("2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:10:00.000Z").getTime())).toBe(true);
  });

  it("treats the exact expiry instant as expired (matches create_order()'s own <= now() check)", () => {
    const at = new Date("2026-01-01T00:00:00.000Z").getTime();
    expect(isQuoteExpired("2026-01-01T00:00:00.000Z", at)).toBe(true);
  });

  it("defaults to the real current time when nowMs is omitted", () => {
    expect(isQuoteExpired("2000-01-01T00:00:00.000Z")).toBe(true);
    expect(isQuoteExpired("2999-01-01T00:00:00.000Z")).toBe(false);
  });
});
