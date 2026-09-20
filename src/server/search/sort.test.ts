import { describe, expect, it } from "vitest";
import { SORT_KEYS, isValidSortKey, parseSortKey } from "./sort";

describe("isValidSortKey", () => {
  it("accepts every real sort key", () => {
    for (const key of SORT_KEYS) {
      expect(isValidSortKey(key)).toBe(true);
    }
  });

  it("rejects an arbitrary/malicious value", () => {
    expect(isValidSortKey("price_cents")).toBe(false);
    expect(isValidSortKey("id; DROP TABLE products; --")).toBe(false);
    expect(isValidSortKey("")).toBe(false);
  });
});

describe("parseSortKey", () => {
  it("passes through a valid key", () => {
    expect(parseSortKey("price_asc")).toBe("price_asc");
  });

  it("falls back to 'newest' for null/undefined/empty/invalid — never throws", () => {
    expect(parseSortKey(null)).toBe("newest");
    expect(parseSortKey(undefined)).toBe("newest");
    expect(parseSortKey("")).toBe("newest");
    expect(parseSortKey("created_at; --")).toBe("newest");
  });
});
