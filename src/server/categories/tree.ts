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

/** Finds a node anywhere in the tree by id, or by slug (either lookup is common: browsing by URL slug, filtering by an id already resolved elsewhere). */
export function findCategoryNode(
  tree: CategoryNode[],
  match: { id?: string; slug?: string },
): CategoryNode | null {
  for (const node of tree) {
    if ((match.id && node.id === match.id) || (match.slug && node.slug === match.slug)) return node;
    const found = findCategoryNode(node.children, match);
    if (found) return found;
  }
  return null;
}

/**
 * A listing's `category_id` always points at a leaf (the create-listing
 * form only ever offers leaves, see leafOptions() above) — so browsing
 * a top-level category like "Clothing" has to match every one of its
 * leaf descendants' ids, not the literal "Clothing" id itself (no
 * product would ever have that as its category_id). For a category
 * that's already a leaf, this is just itself. Used to build the
 * `category_ids` array passed into search_products() — resolving which
 * ids count as "in this category" stays here, in the one place category
 * structure is defined, rather than being duplicated into SQL.
 */
export function leafDescendantIds(node: CategoryNode): string[] {
  if (node.children.length === 0) return [node.id];
  return node.children.flatMap(leafDescendantIds);
}

/** Every category's own (not path-prefixed) name, keyed by id — for labeling a product card with its category without an extra query per card. */
export function categoryNamesById(tree: CategoryNode[]): Record<string, string> {
  const names: Record<string, string> = {};
  const walk = (nodes: CategoryNode[]) => {
    for (const node of nodes) {
      names[node.id] = node.name;
      walk(node.children);
    }
  };
  walk(tree);
  return names;
}
