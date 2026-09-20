import { describe, expect, it } from "vitest";
import { NEARBY_SORT_OPTIONS, isValidNearbySortKey, parseNearbySortKey } from "./nearbySort";

describe("nearby sort allowlist", () => {
  it("includes distance alongside the standard search sorts", () => {
    expect(Object.keys(NEARBY_SORT_OPTIONS).sort()).toEqual(["distance", "newest", "price_asc", "price_desc"].sort());
  });

  it("parseNearbySortKey defaults to distance for anything unrecognized", () => {
    expect(parseNearbySortKey(undefined)).toBe("distance");
    expect(parseNearbySortKey(null)).toBe("distance");
    expect(parseNearbySortKey("price); DROP TABLE products; --")).toBe("distance");
  });

  it("parseNearbySortKey passes through a valid key", () => {
    expect(parseNearbySortKey("price_asc")).toBe("price_asc");
    expect(parseNearbySortKey("newest")).toBe("newest");
  });

  it("isValidNearbySortKey rejects search_products()-only-shaped input", () => {
    expect(isValidNearbySortKey("distance")).toBe(true);
    expect(isValidNearbySortKey("relevance")).toBe(false);
  });
});
