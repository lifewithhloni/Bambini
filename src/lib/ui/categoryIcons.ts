import type { LucideIcon } from "lucide-react";
import { Shirt, Baby, ToyBrick, Milk, BedDouble, HeartHandshake, LayoutGrid } from "@/components/ui/icons";

/**
 * Purely presentational — categories has no icon column in the
 * database (checked before writing this; see
 * 20260920090300_categories_and_products.sql), so this maps the
 * project's actual seeded top-level slugs (supabase/seed.sql) to an
 * icon. Never used to derive anything business-meaningful — a category
 * whose slug isn't in this map (a future new top-level category) still
 * works correctly, just with the generic fallback icon, never an error.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  clothing: Shirt,
  "baby-gear": Baby,
  toys: ToyBrick,
  feeding: Milk,
  nursery: BedDouble,
  maternity: HeartHandshake,
};

export function iconForCategorySlug(slug: string): LucideIcon {
  return CATEGORY_ICONS[slug] ?? LayoutGrid;
}
