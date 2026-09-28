import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";

export type FavouriteState = {
  signedIn: boolean;
  /** Only ever the viewer's OWN saved ids among the ones asked about — never anyone else's, never a count. */
  savedIds: Set<string>;
};

/**
 * One batched read for a whole grid of cards. Anonymous visitors get
 * signedIn: false and no query at all. product_favourites is owner-only
 * under RLS, so even the explicit profile_id filter is defense in depth.
 * A failed read degrades to "nothing shown as saved" rather than
 * breaking the browse page — the database stays authoritative, and a
 * save/unsave click re-derives everything server-side anyway.
 */
export async function getFavouriteState(productIds: string[]): Promise<FavouriteState> {
  const user = await getOptionalUser();
  if (!user) return { signedIn: false, savedIds: new Set() };
  if (productIds.length === 0) return { signedIn: true, savedIds: new Set() };

  const supabase = await createClient();
  const { data, error } = await supabase.from("product_favourites").select("product_id").eq("profile_id", user.id).in("product_id", productIds);
  if (error || !data) return { signedIn: true, savedIds: new Set() };

  return { signedIn: true, savedIds: new Set(data.map((row) => row.product_id)) };
}
