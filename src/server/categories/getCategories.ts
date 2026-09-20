import { createClient } from "@/lib/supabase/server";
import { buildCategoryTree, leafOptions, type FlatCategory } from "./tree";

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
