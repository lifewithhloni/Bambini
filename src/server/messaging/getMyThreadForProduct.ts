import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";

/**
 * The signed-in buyer's existing conversation about a listing, if any —
 * so the listing page can offer "Continue conversation" instead of a
 * second first-message form. Owner-scoped by both the explicit buyer_id
 * filter and RLS; null for a signed-out visitor or when none exists.
 */
export async function getMyThreadForProduct(productId: string): Promise<string | null> {
  const user = await getOptionalUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("message_threads").select("id").eq("buyer_id", user.id).eq("product_id", productId).maybeSingle();
  return data?.id ?? null;
}
