import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-authoritative — get_business_available_balance() independently
 * re-derives authorization (any business member, owner or staff) from
 * auth.uid() and is_business_member(), then re-derives the balance from
 * the same eligibility formula request_business_payout() itself locks
 * and re-checks. A businessId the caller isn't a member of raises
 * inside the RPC, so this simply returns 0 rather than surfacing that
 * as an error — the caller of this helper already gated the page by
 * business membership (see getBusinessForManage()/its RLS), so reaching
 * here with an unauthorized id shouldn't normally happen.
 */
export async function getBusinessAvailableBalance(businessId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_business_available_balance", { p_business_id: businessId });
  if (error || data === null) return 0;
  return Number(data);
}
