import { describe, expect, it } from "vitest";
import { centsToRandInput, formatCentsAsRand, parseRandToCents } from "./price";

describe("parseRandToCents", () => {
  it("parses a whole Rand amount", () => {
    expect(parseRandToCents("250")).toBe(25000);
  });

  it("parses cents", () => {
    expect(parseRandToCents("250.50")).toBe(25050);
    expect(parseRandToCents("250.5")).toBe(25050);
  });

  it("parses a leading R prefix and comma decimal", () => {
    expect(parseRandToCents("R 250,50")).toBe(25050);
    expect(parseRandToCents("R250")).toBe(25000);
  });

  it("parses zero", () => {
    expect(parseRandToCents("0")).toBe(0);
  });

  it("rejects a negative amount", () => {
    expect(parseRandToCents("-50")).toBeNull();
  });

  it("rejects more than 2 decimal places", () => {
    expect(parseRandToCents("250.505")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseRandToCents("abc")).toBeNull();
    expect(parseRandToCents("")).toBeNull();
    expect(parseRandToCents("12.34.56")).toBeNull();
  });

  it("never produces a floating-point artifact for a value that looks safe", () => {
    // 19.99 * 100 in naive float math is 1998.9999999999998, not 1999.
    expect(parseRandToCents("19.99")).toBe(1999);
  });
});

describe("centsToRandInput / formatCentsAsRand", () => {
  it("round-trips through parseRandToCents", () => {
    expect(parseRandToCents(centsToRandInput(25050))).toBe(25050);
  });

  it("formats with the R prefix, en-ZA thousands separator, and 2 decimal places", () => {
    // en-ZA convention: a space as the thousands separator, a comma as
    // the decimal separator — "R 1 234,56", not the US "R 1,234.56".
    const formatted = formatCentsAsRand(123456);
    expect(formatted.startsWith("R")).toBe(true);
    expect(formatted).toContain("234");
    expect(formatted).toMatch(/56$/);
  });
});
