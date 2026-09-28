"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";

export type FavouriteActionResult = { saved: boolean } | { error: string; authRequired?: boolean };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The owner is always the signed-in user resolved server-side — never a
 * client argument. product_favourites' single owner policy
 * (profile_id = auth.uid(), both USING and WITH CHECK) is the real
 * boundary; a client naming another user could not insert regardless, and
 * this action never gives it the chance. Saving is allowed only for a
 * listing the caller can currently see as *published* (the products read
 * is RLS-scoped, so a draft/archived/sold listing of someone else is
 * simply "not found" here). The composite primary key
 * (profile_id, product_id) makes a repeat save a database-level no-op
 * (ON CONFLICT DO NOTHING) rather than a duplicate or an error.
 */
export async function saveListing(productId: string): Promise<FavouriteActionResult> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in to save items.", authRequired: true };
  if (!UUID_PATTERN.test(productId)) return { error: "This listing isn't available to save." };

  const supabase = await createClient();

  const { data: product } = await supabase.from("products").select("id").eq("id", productId).eq("status", "published").maybeSingle();
  if (!product) return { error: "This listing isn't available to save." };

  const { error } = await supabase
    .from("product_favourites")
    .upsert({ profile_id: user.id, product_id: productId }, { onConflict: "profile_id,product_id", ignoreDuplicates: true });
  if (error) return { error: "Couldn't save this item. Please try again." };

  revalidatePath("/account/saved");
  return { saved: true };
}

/**
 * Scoped to the caller's own row by both the explicit profile_id filter
 * and the owner RLS policy; removing something that isn't saved (or was
 * already removed) matches zero rows and is reported as success — the
 * end state the caller asked for is already true. Deliberately works for
 * a listing that has since become unavailable, since that's exactly
 * when a user wants to clear it from their saved history.
 */
export async function unsaveListing(productId: string): Promise<FavouriteActionResult> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in to manage saved items.", authRequired: true };
  if (!UUID_PATTERN.test(productId)) return { saved: false };

  const supabase = await createClient();
  const { error } = await supabase.from("product_favourites").delete().eq("profile_id", user.id).eq("product_id", productId);
  if (error) return { error: "Couldn't remove this item. Please try again." };

  revalidatePath("/account/saved");
  return { saved: false };
}
