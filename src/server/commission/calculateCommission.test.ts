import { describe, expect, it } from "vitest";
import { calculateCommission } from "./calculateCommission";

describe("calculateCommission", () => {
  it("applies the 12% parent rate by default", () => {
    const result = calculateCommission("parent", 100_000); // R1,000.00
    expect(result.commissionAmountCents).toBe(12_000);
    expect(result.netAmountCents).toBe(88_000);
  });

  it("applies the 15% business rate by default", () => {
    const result = calculateCommission("business", 100_000);
    expect(result.commissionAmountCents).toBe(15_000);
    expect(result.netAmountCents).toBe(85_000);
  });

  it("accepts an explicit historical rate override", () => {
    const result = calculateCommission("parent", 100_000, 1000); // 10%
    expect(result.commissionAmountCents).toBe(10_000);
  });

  it("rounds half up to the nearest cent", () => {
    const result = calculateCommission("parent", 999, 1200); // 119.88 -> 120
    expect(result.commissionAmountCents).toBe(120);
  });

  it("rejects a non-integer amount", () => {
    expect(() => calculateCommission("parent", 100.5)).toThrow();
  });

  it("rejects a negative amount", () => {
    expect(() => calculateCommission("parent", -100)).toThrow();
  });

  it("rejects an out-of-range rate", () => {
    expect(() => calculateCommission("parent", 100_000, 10_001)).toThrow();
  });
});
