import { describe, expect, it } from "vitest";
import { slugify, SLUG_PATTERN } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates a business name", () => {
    expect(slugify("Little Treasures")).toBe("little-treasures");
  });

  it("strips punctuation", () => {
    expect(slugify("Bob's Baby Boutique!")).toBe("bobs-baby-boutique");
  });

  it("collapses multiple spaces/hyphens into one", () => {
    expect(slugify("Toys   &   More")).toBe("toys-more");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  - Nappies Plus - ")).toBe("nappies-plus");
  });

  it("always produces output matching the database's own slug format constraint", () => {
    const result = slugify("Café Petit Bébé 123");
    expect(result).toMatch(SLUG_PATTERN);
  });
});
