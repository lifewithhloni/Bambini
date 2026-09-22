import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BusinessPayout = {
  id: string;
  amountCents: number;
  status: string;
  orderCount: number;
  createdAt: string;
  paidAt: string | null;
};

/**
 * A specific business's own payout history — any member (owner or
 * staff) may read it, matching payouts_select_recipient_or_admin's own
 * is_business_member() scope. The explicit .eq("recipient_business_id",
 * businessId) filter narrows an otherwise-multi-business-capable RLS
 * read down to the one business this page is about — the same
 * explicit-filter-on-top-of-RLS pattern getMyBusinesses() already uses.
 * A businessId the caller isn't a member of simply returns zero rows
 * (RLS), never an error — the same not-found-vs-not-yours privacy
 * pattern used throughout this codebase. Deliberately selects only
 * amount/status/dates — never recovery_reason/recovered_by, matching
 * getMyPayouts()'s own "don't expose internal admin notes" scope.
 */
export async function getBusinessPayouts(businessId: string): Promise<BusinessPayout[]> {
  const supabase = await createClient();

  const { data: payouts, error } = await supabase
    .from("payouts")
    .select("id, amount_cents, status, created_at, paid_at")
    .eq("recipient_business_id", businessId)
    .order("created_at", { ascending: false });

  if (error || !payouts || payouts.length === 0) return [];

  const { data: items } = await supabase
    .from("payout_items")
    .select("payout_id")
    .in(
      "payout_id",
      payouts.map((p) => p.id),
    );

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
