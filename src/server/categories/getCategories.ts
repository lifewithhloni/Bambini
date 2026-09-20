import { createClient } from "@/lib/supabase/server";
import { buildCategoryTree, findCategoryNode, leafDescendantIds, leafOptions, type CategoryNode, type FlatCategory } from "./tree";

/** Categories are public reference data (RLS: select using (true)) — no auth required to read them. */
export async function getCategoryTree() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, parent_id, name, slug, sort_order")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`Failed to load categories: ${error.message}`);

  return buildCategoryTree((data ?? []) as FlatCategory[]);
}

/** The options a listing's category picker offers: every leaf category, labeled "Parent > Child". Never a hard-coded list — always read fresh from the database. */
export async function getCategoryOptions() {
  return leafOptions(await getCategoryTree());
}

/**
 * For a category page (`/category/[slug]`): finds the node for the URL
 * slug, and resolves the `category_ids` array to actually filter
 * listings by (itself if it's a leaf, every leaf descendant if it's a
 * parent like "Clothing" — see leafDescendantIds()). Returns null for
 * an unknown/inactive slug so the page can 404 rather than show an
 * empty "category" with no name.
 */
export async function getCategoryBySlug(
  slug: string,
): Promise<{ node: CategoryNode; categoryIds: string[] } | null> {
  const tree = await getCategoryTree();
  const node = findCategoryNode(tree, { slug });
  if (!node) return null;
  return { node, categoryIds: leafDescendantIds(node) };
}
