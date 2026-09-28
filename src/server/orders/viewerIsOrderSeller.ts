import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * RLS already guarantees getOrder() only ever returns a row the caller
 * participates in (buyer, seller, or admin) — but that alone doesn't
 * distinguish *which* role the caller has, and seller-framed views render
 * commission info that must never reach a buyer just because they happen
 * to also be able to read the row. This explicitly confirms seller
 * ownership: the order's parent seller, or the owner/any member of the
 * business that sold it — the same business-membership resolution
 * getSellerOrders.ts/getMyListings.ts already use.
 *
 * Moved verbatim out of /sell/orders/[id]/page.tsx (Phase 13B) so the
 * business-scoped order detail can share the identical check and it can be
 * tested; its logic is unchanged.
 */
export async function viewerIsOrderSeller(order: { seller_profile_id: string | null; business_id: string | null }, userId: string): Promise<boolean> {
  if (order.seller_profile_id === userId) return true;
  if (!order.business_id) return false;

  const supabase = await createClient();
  const [{ data: owned }, { data: member }] = await Promise.all([
    supabase.from("businesses").select("id").eq("id", order.business_id).eq("owner_profile_id", userId).maybeSingle(),
    supabase.from("business_members").select("business_id").eq("business_id", order.business_id).eq("profile_id", userId).maybeSingle(),
  ]);
  return !!owned || !!member;
}
