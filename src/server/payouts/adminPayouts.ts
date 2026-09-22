import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type PayoutOrderLine = {
  orderId: string;
  orderReference: string | null;
  amountCents: number;
};

export type PayoutRecord = {
  id: string;
  sellerType: "parent" | "business";
  sellerName: string | null;
  amountCents: number;
  status: string;
  orderCount: number;
  createdAt: string;
  paidAt: string | null;
  providerReference: string | null;
  // Phase 8B — only ever set together, once this payout has been
  // recovered (status = 'recovered').
  recoveredByName: string | null;
  recoveredAt: string | null;
  recoveryReason: string | null;
  // Phase 8B (extension) — the specific orders this payout claims, for
  // the admin's own "included orders" view. Never shown to a seller
  // (getMyPayouts() deliberately doesn't select this).
  orders: PayoutOrderLine[];
};

/**
 * Admin-only — every existing payout record, newest first. Same "RLS is
 * the real boundary, requireAdmin() is the UI convenience" split as
 * listPayoutEligibleOrders(); payouts_select_recipient_or_admin already
 * permits an admin's own session to read every row.
 */
export async function listPayouts(): Promise<PayoutRecord[]> {
  await requireAdmin("/admin/payouts");
  const supabase = await createClient();

  const { data: payouts, error } = await supabase
    .from("payouts")
    .select("id, recipient_type, recipient_profile_id, recipient_business_id, amount_cents, status, created_at, paid_at, provider_reference, recovered_by, recovered_at, recovery_reason")
    .order("created_at", { ascending: false });

  if (error || !payouts || payouts.length === 0) return [];

  const payoutIds = payouts.map((p) => p.id);
  const sellerProfileIds = Array.from(new Set(payouts.filter((p) => p.recipient_type === "parent" && p.recipient_profile_id).map((p) => p.recipient_profile_id as string)));
  const businessIds = Array.from(new Set(payouts.filter((p) => p.recipient_type === "business" && p.recipient_business_id).map((p) => p.recipient_business_id as string)));
  // Separate from sellerProfileIds — the admin who recovered a payout is
  // almost never the same person as the seller being paid.
  const recoveredByIds = Array.from(new Set(payouts.filter((p) => p.recovered_by).map((p) => p.recovered_by as string)));

  const [{ data: items }, { data: profiles }, { data: businesses }, { data: admins }] = await Promise.all([
    supabase.from("payout_items").select("payout_id, order_id, amount_cents").in("payout_id", payoutIds),
    sellerProfileIds.length > 0
      ? supabase.from("profiles_public").select("id, full_name").in("id", sellerProfileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    businessIds.length > 0
      ? supabase.from("businesses_public").select("id, business_name").in("id", businessIds)
      : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
    recoveredByIds.length > 0
      ? supabase.from("profiles_public").select("id, full_name").in("id", recoveredByIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const orderIds = Array.from(new Set((items ?? []).map((i) => i.order_id)));
  const { data: orders } =
    orderIds.length > 0
      ? await supabase.from("orders").select("id, order_reference").in("id", orderIds)
      : { data: [] as { id: string; order_reference: string }[] };
  const referenceByOrderId = new Map((orders ?? []).map((o) => [o.id, o.order_reference]));

  const countByPayoutId = new Map<string, number>();
  const ordersByPayoutId = new Map<string, PayoutOrderLine[]>();
  for (const item of items ?? []) {
    countByPayoutId.set(item.payout_id, (countByPayoutId.get(item.payout_id) ?? 0) + 1);
    const line: PayoutOrderLine = {
      orderId: item.order_id,
      orderReference: referenceByOrderId.get(item.order_id) ?? null,
      amountCents: item.amount_cents,
    };
    ordersByPayoutId.set(item.payout_id, [...(ordersByPayoutId.get(item.payout_id) ?? []), line]);
  }
  const nameByProfileId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const nameByBusinessId = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));
  const nameByAdminId = new Map((admins ?? []).map((a) => [a.id, a.full_name]));

  return payouts.map((p) => ({
    id: p.id,
    sellerType: p.recipient_type,
    sellerName: p.recipient_type === "parent" ? (nameByProfileId.get(p.recipient_profile_id ?? "") ?? null) : (nameByBusinessId.get(p.recipient_business_id ?? "") ?? null),
    amountCents: p.amount_cents,
    status: p.status,
    orderCount: countByPayoutId.get(p.id) ?? 0,
    createdAt: p.created_at,
    paidAt: p.paid_at,
    providerReference: p.provider_reference,
    recoveredByName: p.recovered_by ? (nameByAdminId.get(p.recovered_by) ?? null) : null,
    recoveredAt: p.recovered_at,
    recoveryReason: p.recovery_reason,
    orders: ordersByPayoutId.get(p.id) ?? [],
  }));
}
