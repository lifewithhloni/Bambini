import { describe, expect, it } from "vitest";
import { iconForCategorySlug } from "./categoryIcons";
import { Shirt, Baby, ToyBrick, Milk, BedDouble, HeartHandshake, LayoutGrid } from "@/components/ui/icons";

describe("iconForCategorySlug", () => {
  it("maps every real seeded top-level category slug (supabase/seed.sql) to a distinct icon", () => {
    expect(iconForCategorySlug("clothing")).toBe(Shirt);
    expect(iconForCategorySlug("baby-gear")).toBe(Baby);
    expect(iconForCategorySlug("toys")).toBe(ToyBrick);
    expect(iconForCategorySlug("feeding")).toBe(Milk);
    expect(iconForCategorySlug("nursery")).toBe(BedDouble);
    expect(iconForCategorySlug("maternity")).toBe(HeartHandshake);
  });

  it("falls back to a generic icon for an unmapped/future category slug, never throwing", () => {
    expect(iconForCategorySlug("some-brand-new-category")).toBe(LayoutGrid);
    expect(iconForCategorySlug("")).toBe(LayoutGrid);
  });
});
