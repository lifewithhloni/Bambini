import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-authoritative — get_seller_available_balance() independently
 * re-derives this from auth.uid() and the exact same eligibility
 * formula request_seller_payout() itself locks and re-checks before
 * creating a payout (completed, online, not already actively claimed).
 * Never a stored value that could drift from the underlying ledger, and
 * never trusts anything the client supplies. Parent sellers only — see
 * 20261006090000_seller_requested_payouts.sql for why business payouts
 * stay admin-initiated for now; a business member simply always reads 0
 * here, which is correct given they have no personal (seller_type =
 * 'parent') orders of their own.
 */
export async function getMyAvailableBalance(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_seller_available_balance");
  if (error || data === null) return 0;
  return Number(data);
}
