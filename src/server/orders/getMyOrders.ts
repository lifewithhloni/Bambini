import { createClient } from "@/lib/supabase/server";

export type OrderSummary = {
  id: string;
  order_reference: string;
  status: string;
  payment_status: string;
  fulfilment_type: string;
  total_cents: number;
  currency: string;
  created_at: string;
  productTitle: string | null;
};

/**
 * Three flat queries (orders, then order_items + payments batched by the
 * resulting order ids) rather than a nested PostgREST embed — see
 * getOrder.ts's header comment for why. Scoped to the caller's own
 * orders via buyer_id, mirroring RLS (orders_select_participant_or_admin)
 * rather than relying on it alone.
 */
export async function getMyOrders(buyerId: string): Promise<OrderSummary[]> {
  const supabase = await createClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_reference, status, fulfilment_type, total_cents, currency, created_at")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });

  if (error || !orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("order_items").select("order_id, title_snapshot").in("order_id", orderIds),
    supabase.from("payments").select("order_id, status").in("order_id", orderIds),
  ]);

  const titleByOrder = new Map((items ?? []).map((i) => [i.order_id, i.title_snapshot]));
  const paymentStatusByOrder = new Map((payments ?? []).map((p) => [p.order_id, p.status]));

  return orders.map((o) => ({
    id: o.id,
    order_reference: o.order_reference,
    status: o.status,
    payment_status: paymentStatusByOrder.get(o.id) ?? "pending",
    fulfilment_type: o.fulfilment_type,
    total_cents: o.total_cents,
    currency: o.currency,
    created_at: o.created_at,
    productTitle: titleByOrder.get(o.id) ?? null,
  }));
}
