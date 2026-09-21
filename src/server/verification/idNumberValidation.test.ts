import { describe, expect, it } from "vitest";
import { isThirteenDigits, maskIdNumber, validateSaIdNumber } from "./idNumberValidation";

describe("isThirteenDigits", () => {
  it("accepts exactly 13 digits", () => {
    expect(isThirteenDigits("9001015000085")).toBe(true);
  });
  it("rejects too few digits", () => {
    expect(isThirteenDigits("12345")).toBe(false);
  });
  it("rejects non-digit characters", () => {
    expect(isThirteenDigits("900101500008A")).toBe(false);
  });
});

describe("validateSaIdNumber", () => {
  it("accepts a numerically valid SA ID number (correct Luhn checksum)", () => {
    // 900101 5000 0 8 5 — birthdate 1990-01-01, gender sequence 5000,
    // citizen (0), A=8, checksum digit computed via the standard SA ID
    // Luhn algorithm.
    expect(validateSaIdNumber("9001015000085")).toEqual({ ok: true });
  });

  it("rejects the same number with the checksum digit altered", () => {
    const result = validateSaIdNumber("9001015000086");
    expect(result.ok).toBe(false);
  });

  it("rejects a non-13-digit value before even attempting a checksum", () => {
    const result = validateSaIdNumber("123");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/13-digit/i) });
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateSaIdNumber("  9001015000085  ")).toEqual({ ok: true });
  });

  it("rejects letters even if 13 characters long", () => {
    const result = validateSaIdNumber("900101500008A");
    expect(result.ok).toBe(false);
  });
});

describe("maskIdNumber", () => {
  it("shows only the last 4 digits", () => {
    expect(maskIdNumber("9001015000085")).toBe("•••••••••0085");
  });
  it("degrades gracefully for a short/malformed value", () => {
    expect(maskIdNumber("12")).toBe("••••");
  });
});
