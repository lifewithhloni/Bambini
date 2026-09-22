import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MyPayout = {
  id: string;
  amountCents: number;
  status: string;
  orderCount: number;
  createdAt: string;
  paidAt: string | null;
};

/**
 * The signed-in user's own payouts — as a parent seller, or as a member
 * of any business they belong to. Relies entirely on
 * payouts_select_recipient_or_admin (recipient_profile_id = auth.uid()
 * or is_business_member(recipient_business_id)) — this is a plain
 * RLS-scoped read, no explicit .eq() filter needed, since RLS already
 * returns exactly and only the rows this caller is allowed to see; a
 * buyer or an unrelated seller gets zero rows back, not an error,
 * matching every other "my own X" read in this codebase.
 */
export async function getMyPayouts(): Promise<MyPayout[]> {
  const supabase = await createClient();

  const { data: payouts, error } = await supabase
    .from("payouts")
    .select("id, amount_cents, status, created_at, paid_at")
    .order("created_at", { ascending: false });

  if (error || !payouts || payouts.length === 0) return [];

  const { data: items } = await supabase
    .from("payout_items")
    .select("payout_id")
    .in("payout_id", payouts.map((p) => p.id));

  const countByPayoutId = new Map<string, number>();
  for (const item of items ?? []) {
    countByPayoutId.set(item.payout_id, (countByPayoutId.get(item.payout_id) ?? 0) + 1);
  }

  return payouts.map((p) => ({
    id: p.id,
    amountCents: p.amount_cents,
    status: p.status,
    orderCount: countByPayoutId.get(p.id) ?? 0,
    createdAt: p.created_at,
    paidAt: p.paid_at,
  }));
}
