import { describe, expect, it } from "vitest";
import { calculateSubtotalCents, countAvailable } from "./cartMath";

describe("calculateSubtotalCents", () => {
  it("sums only available lines", () => {
    const lines = [
      { status: "available", priceCents: 10000 },
      { status: "sold", priceCents: 5000 },
      { status: "available", priceCents: 25000 },
    ];
    expect(calculateSubtotalCents(lines)).toBe(35000);
  });

  it("excludes sold/unavailable/own_listing/deleted lines from the subtotal", () => {
    const lines = [
      { status: "sold", priceCents: 10000 },
      { status: "unavailable", priceCents: 10000 },
      { status: "own_listing", priceCents: 10000 },
      { status: "deleted", priceCents: null },
    ];
    expect(calculateSubtotalCents(lines)).toBe(0);
  });

  it("returns 0 for an empty cart", () => {
    expect(calculateSubtotalCents([])).toBe(0);
  });

  it("treats a null priceCents (deleted line) as contributing nothing, never throwing", () => {
    expect(calculateSubtotalCents([{ status: "available", priceCents: null }])).toBe(0);
  });
});

describe("countAvailable", () => {
  it("counts only available lines, matching what the subtotal is actually for", () => {
    const lines = [
      { status: "available", priceCents: 10000 },
      { status: "sold", priceCents: 5000 },
      { status: "available", priceCents: 25000 },
    ];
    expect(countAvailable(lines)).toBe(2);
  });

  it("returns 0 for an empty cart", () => {
    expect(countAvailable([])).toBe(0);
  });
});
