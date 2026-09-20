export type FlatCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
};

export type CategoryNode = FlatCategory & {
  children: CategoryNode[];
};

/**
 * Pure — no DB access — so the nesting logic can be unit tested without
 * a database. Categories are database-driven (no hard-coded list in the
 * app); this just turns the flat `parent_id`-linked rows Postgres gives
 * us into a tree the UI can render as a select/accordion.
 */
export function buildCategoryTree(flat: FlatCategory[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const cat of flat) {
    byId.set(cat.id, { ...cat, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const cat of flat) {
    const node = byId.get(cat.id)!;
    if (cat.parent_id && byId.has(cat.parent_id)) {
      byId.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const bySortOrder = (a: FlatCategory, b: FlatCategory) => a.sort_order - b.sort_order;
  const sortRecursive = (nodes: CategoryNode[]) => {
    nodes.sort(bySortOrder);
    for (const node of nodes) sortRecursive(node.children);
  };
  sortRecursive(roots);

  return roots;
}

/** Flattens a tree back into "Parent > Child" labeled options, leaves only — what a listing's category picker offers (a listing belongs to a leaf category, not a top-level group). */
export function leafOptions(tree: CategoryNode[]): { id: string; label: string }[] {
  const options: { id: string; label: string }[] = [];
  const walk = (nodes: CategoryNode[], trail: string[]) => {
    for (const node of nodes) {
      const path = [...trail, node.name];
      if (node.children.length === 0) {
        options.push({ id: node.id, label: path.join(" > ") });
      } else {
        walk(node.children, path);
      }
    }
  };
  walk(tree, []);
  return options;
}
