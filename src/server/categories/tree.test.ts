import { describe, expect, it } from "vitest";
import { buildCategoryTree, leafOptions, type FlatCategory } from "./tree";

const flat: FlatCategory[] = [
  { id: "clothing", parent_id: null, name: "Clothing", slug: "clothing", sort_order: 1 },
  { id: "toys", parent_id: null, name: "Toys", slug: "toys", sort_order: 2 },
  { id: "newborn", parent_id: "clothing", name: "Newborn", slug: "clothing-newborn", sort_order: 1 },
  { id: "toddler-clothing", parent_id: "clothing", name: "Toddler", slug: "clothing-toddler", sort_order: 2 },
  { id: "baby-toys", parent_id: "toys", name: "Baby Toys", slug: "toys-baby", sort_order: 1 },
];

describe("buildCategoryTree", () => {
  it("nests children under their parent", () => {
    const tree = buildCategoryTree(flat);
    expect(tree.map((c) => c.id)).toEqual(["clothing", "toys"]);
    expect(tree[0].children.map((c) => c.id)).toEqual(["newborn", "toddler-clothing"]);
    expect(tree[1].children.map((c) => c.id)).toEqual(["baby-toys"]);
  });

  it("sorts siblings by sort_order at every level", () => {
    const shuffled: FlatCategory[] = [
      { id: "b", parent_id: null, name: "B", slug: "b", sort_order: 2 },
      { id: "a", parent_id: null, name: "A", slug: "a", sort_order: 1 },
    ];
    const tree = buildCategoryTree(shuffled);
    expect(tree.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("treats a category with a missing/unknown parent_id as a root, not a dropped node", () => {
    const orphan: FlatCategory[] = [{ id: "x", parent_id: "does-not-exist", name: "X", slug: "x", sort_order: 1 }];
    const tree = buildCategoryTree(orphan);
    expect(tree.map((c) => c.id)).toEqual(["x"]);
  });

  it("handles an empty list", () => {
    expect(buildCategoryTree([])).toEqual([]);
  });
});

describe("leafOptions", () => {
  it("only includes leaf categories, labeled with their full path", () => {
    const tree = buildCategoryTree(flat);
    const options = leafOptions(tree);
    expect(options).toEqual([
      { id: "newborn", label: "Clothing > Newborn" },
      { id: "toddler-clothing", label: "Clothing > Toddler" },
      { id: "baby-toys", label: "Toys > Baby Toys" },
    ]);
  });

  it("excludes top-level categories that have children", () => {
    const tree = buildCategoryTree(flat);
    const options = leafOptions(tree);
    expect(options.some((o) => o.id === "clothing")).toBe(false);
    expect(options.some((o) => o.id === "toys")).toBe(false);
  });
});
