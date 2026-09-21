import { describe, expect, it } from "vitest";
import { centsToDecimalString, decimalStringToCents } from "./money";

describe("centsToDecimalString", () => {
  it("converts the documented examples exactly", () => {
    expect(centsToDecimalString(49999)).toBe("499.99");
    expect(centsToDecimalString(50000)).toBe("500.00");
    expect(centsToDecimalString(1)).toBe("0.01");
  });

  it("handles round amounts, small amounts, and larger amounts", () => {
    expect(centsToDecimalString(0)).toBe("0.00");
    expect(centsToDecimalString(100)).toBe("1.00");
    expect(centsToDecimalString(999)).toBe("9.99");
    expect(centsToDecimalString(10000)).toBe("100.00");
    expect(centsToDecimalString(123456789)).toBe("1234567.89");
  });

  it("throws on a non-integer amount rather than silently truncating", () => {
    expect(() => centsToDecimalString(49999.5)).toThrow();
  });

  it("throws on a negative amount", () => {
    expect(() => centsToDecimalString(-100)).toThrow();
  });
});

describe("decimalStringToCents", () => {
  it("converts the documented examples exactly", () => {
    expect(decimalStringToCents("499.99")).toBe(49999);
    expect(decimalStringToCents("500.00")).toBe(50000);
    expect(decimalStringToCents("0.01")).toBe(1);
  });

  it("handles small and large amounts", () => {
    expect(decimalStringToCents("1.00")).toBe(100);
    expect(decimalStringToCents("9.99")).toBe(999);
    expect(decimalStringToCents("100.00")).toBe(10000);
  });

  it("accepts a whole number with no decimal point", () => {
    expect(decimalStringToCents("500")).toBe(50000);
  });

  it("accepts a single decimal place", () => {
    expect(decimalStringToCents("500.5")).toBe(50050);
  });

  it("rejects more than two decimal places rather than rounding", () => {
    expect(decimalStringToCents("499.999")).toBeNull();
    expect(decimalStringToCents("1.001")).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(decimalStringToCents("-100.00")).toBeNull();
  });

  it("rejects an invalid/malformed decimal string", () => {
    expect(decimalStringToCents("abc")).toBeNull();
    expect(decimalStringToCents("")).toBeNull();
    expect(decimalStringToCents("100.00.00")).toBeNull();
    expect(decimalStringToCents("R100.00")).toBeNull();
    expect(decimalStringToCents("1e5")).toBeNull();
    expect(decimalStringToCents("NaN")).toBeNull();
    expect(decimalStringToCents("Infinity")).toBeNull();
  });

  it("round-trips with centsToDecimalString for a range of values", () => {
    for (const cents of [1, 50, 99, 100, 999, 12345, 100000, 4999999]) {
      expect(decimalStringToCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});
