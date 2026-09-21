import { createClient } from "@/lib/supabase/server";

/**
 * Thin wrapper around get_my_collection_code() (SECURITY DEFINER,
 * buyer-only — see 20260927090000_cash_collection_transactions.sql).
 * Returns null on any failure (wrong caller, no collection record, order
 * not found) rather than surfacing the raw Postgres error — the caller
 * only ever needs "is there a code to show," not why not.
 */
export async function getMyCollectionCode(orderId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_collection_code", { p_order_id: orderId });
  if (error || !data) return null;
  return data;
}
