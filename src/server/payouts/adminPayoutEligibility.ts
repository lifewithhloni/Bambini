import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type EligibleOrder = {
  orderId: string;
  orderReference: string;
  subtotalCents: number;
  commissionAmountCents: number;
  netEarningsCents: number;
  completedAt: string;
};

export type EligibleSellerGroup = {
  key: string;
  sellerType: "parent" | "business";
  sellerProfileId: string | null;
  businessId: string | null;
  sellerName: string | null;
  orders: EligibleOrder[];
  totalNetCents: number;
};

/**
 * Admin-only (requireAdmin() 404s otherwise) — orders that are
 * completed, paid online, and have no currently-ACTIVE payout_items
 * claim (superseded_at is null — see
 * 20261005090000_payout_recovery.sql). A recovered order's old claim is
 * superseded, not deleted, so it's correctly excluded from this filter
 * and the order becomes eligible again, exactly as Phase 8B intends.
 * RLS (orders_select_participant_or_admin,
 * payout_items_select_recipient_or_admin) already permits an admin's
 * own session to read everything this needs directly — unlike Phase
 * 7D's delivery-financials view, nothing here is column-restricted, so
 * no SECURITY DEFINER wrapper is needed for the read side; only the
 * actual payout creation (create_seller_payout()) needs one, since
 * payouts/payout_items have no authenticated write policy at all.
 *
 * A cash order can never appear here — payment_method = 'online' is
 * part of the eligibility definition itself, matching
 * create_seller_payout()'s own independent re-check.
 */
export async function listPayoutEligibleOrders(): Promise<EligibleSellerGroup[]> {
  await requireAdmin("/admin/payouts");
  const supabase = await createClient();

  const [{ data: orders }, { data: payoutItems }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_reference, subtotal_cents, commission_amount_cents, completed_at, seller_type, seller_profile_id, business_id")
      .eq("payment_method", "online")
      .eq("status", "completed")
      .order("completed_at", { ascending: true }),
    supabase.from("payout_items").select("order_id").is("superseded_at", null),
  ]);

  if (!orders) return [];

  const alreadyClaimed = new Set((payoutItems ?? []).map((p) => p.order_id));
  const eligible = orders.filter((o) => !alreadyClaimed.has(o.id));
  if (eligible.length === 0) return [];

  const sellerProfileIds = Array.from(new Set(eligible.filter((o) => o.seller_type === "parent" && o.seller_profile_id).map((o) => o.seller_profile_id as string)));
  const businessIds = Array.from(new Set(eligible.filter((o) => o.seller_type === "business" && o.business_id).map((o) => o.business_id as string)));

  const [{ data: profiles }, { data: businesses }] = await Promise.all([
    sellerProfileIds.length > 0
      ? supabase.from("profiles_public").select("id, full_name").in("id", sellerProfileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    businessIds.length > 0
      ? supabase.from("businesses_public").select("id, business_name").in("id", businessIds)
      : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
  ]);

  const nameByProfileId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const nameByBusinessId = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  const groups = new Map<string, EligibleSellerGroup>();
  for (const o of eligible) {
    const key = o.seller_type === "parent" ? `parent:${o.seller_profile_id}` : `business:${o.business_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sellerType: o.seller_type,
        sellerProfileId: o.seller_profile_id,
        businessId: o.business_id,
        sellerName: o.seller_type === "parent" ? (nameByProfileId.get(o.seller_profile_id ?? "") ?? null) : (nameByBusinessId.get(o.business_id ?? "") ?? null),
        orders: [],
        totalNetCents: 0,
      });
    }
    const group = groups.get(key)!;
    const netEarningsCents = o.subtotal_cents - o.commission_amount_cents;
    group.orders.push({
      orderId: o.id,
      orderReference: o.order_reference,
      subtotalCents: o.subtotal_cents,
      commissionAmountCents: o.commission_amount_cents,
      netEarningsCents,
      completedAt: o.completed_at ?? "",
    });
    group.totalNetCents += netEarningsCents;
  }

  return Array.from(groups.values());
}
