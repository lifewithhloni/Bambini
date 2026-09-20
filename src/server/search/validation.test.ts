import { describe, expect, it } from "vitest";
import { firstValue, searchQuerySchema } from "./validation";

describe("searchQuerySchema", () => {
  it("parses a fully empty query into sane defaults", () => {
    const r = searchQuerySchema.parse({});
    expect(r).toEqual({
      q: undefined,
      category: undefined,
      condition: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      collection: false,
      delivery: false,
      sort: "newest",
      page: 1,
    });
  });

  it("parses a realistic full query", () => {
    const r = searchQuerySchema.parse({
      q: "stroller",
      condition: "excellent",
      minPrice: "500",
      maxPrice: "3000",
      collection: "1",
      sort: "price_asc",
      page: "2",
    });
    expect(r.q).toBe("stroller");
    expect(r.condition).toBe("excellent");
    expect(r.minPrice).toBe(50000);
    expect(r.maxPrice).toBe(300000);
    expect(r.collection).toBe(true);
    expect(r.delivery).toBe(false);
    expect(r.sort).toBe("price_asc");
    expect(r.page).toBe(2);
  });

  it("silently drops an invalid condition instead of erroring — a shared URL must not break", () => {
    const r = searchQuerySchema.parse({ condition: "brand-new-not-real" });
    expect(r.condition).toBeUndefined();
  });

  it("silently drops an unparseable price instead of erroring", () => {
    const r = searchQuerySchema.parse({ minPrice: "not-a-number" });
    expect(r.minPrice).toBeUndefined();
  });

  it("falls back to 'newest' for a malicious/unknown sort value rather than passing it through", () => {
    const r = searchQuerySchema.parse({ sort: "price_cents; DROP TABLE products; --" });
    expect(r.sort).toBe("newest");
  });

  it("silently drops an invalid category id (not a UUID) rather than erroring", () => {
    const r = searchQuerySchema.parse({ category: "not-a-uuid" });
    expect(r.category).toBeUndefined();
  });

  it("clamps a negative, zero, or absurdly large page to a safe value", () => {
    expect(searchQuerySchema.parse({ page: "0" }).page).toBe(1);
    expect(searchQuerySchema.parse({ page: "-5" }).page).toBe(1);
    expect(searchQuerySchema.parse({ page: "abc" }).page).toBe(1);
    expect(searchQuerySchema.parse({ page: "999999999" }).page).toBe(10_000);
  });

  it("treats an empty-string query param the same as an absent one", () => {
    const r = searchQuerySchema.parse({ q: "", minPrice: "", condition: "" });
    expect(r.q).toBeUndefined();
    expect(r.minPrice).toBeUndefined();
    expect(r.condition).toBeUndefined();
  });

  it("trims and caps an overly long search term", () => {
    const r = searchQuerySchema.parse({ q: "  stroller  " });
    expect(r.q).toBe("stroller");
  });
});

describe("firstValue", () => {
  it("passes through a plain string", () => {
    expect(firstValue("stroller")).toBe("stroller");
  });
  it("takes the first of a repeated-key array", () => {
    expect(firstValue(["a", "b"])).toBe("a");
  });
  it("passes through undefined", () => {
    expect(firstValue(undefined)).toBeUndefined();
  });
});
