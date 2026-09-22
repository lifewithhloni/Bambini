import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type DeliveryFinancialTransaction = {
  orderId: string;
  orderReference: string;
  createdAt: string;
  fulfilmentType: string;
  providerSlug: string | null;
  providerDeliveryCostCents: number;
  buyerDeliveryFeeCents: number;
  deliveryMarkupPercentageBps: number;
  deliveryMarkupAmountCents: number;
  deliveryMarginCents: number;
  deliveryStatus: string | null;
  paymentStatus: string | null;
};

export type DeliveryFinancialFilters = {
  fulfilmentType?: "collection" | "delivery";
  deliveryStatus?: string;
  paymentStatus?: string;
  providerSlug?: string;
  createdAfter?: string;
  createdBefore?: string;
};

/**
 * Admin-only (requireAdmin() 404s otherwise) — list_delivery_financial_transactions()'s
 * own is_admin() check (SECURITY DEFINER) is the actual data boundary,
 * the same "UI convenience vs. real boundary" split every other admin
 * page in this codebase already uses. This is the only sanctioned read
 * of the columns orders'/delivery_quotes' own column-level SELECT grant
 * now excludes for `authenticated` (see
 * 20261003090000_delivery_financial_privacy.sql) — a plain
 * `.from("orders")` call, even from an admin's own session, cannot read
 * these fields; only this SECURITY DEFINER function can.
 */
export async function listDeliveryFinancialTransactions(filters: DeliveryFinancialFilters = {}): Promise<DeliveryFinancialTransaction[]> {
  await requireAdmin("/admin/delivery/transactions");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_delivery_financial_transactions", {
    p_fulfilment_type: filters.fulfilmentType ?? null,
    p_delivery_status: (filters.deliveryStatus as never) ?? null,
    p_payment_status: (filters.paymentStatus as never) ?? null,
    p_provider_slug: filters.providerSlug ?? null,
    p_created_after: filters.createdAfter ?? null,
    p_created_before: filters.createdBefore ?? null,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    orderId: row.order_id,
    orderReference: row.order_reference,
    createdAt: row.created_at,
    fulfilmentType: row.fulfilment_type,
    providerSlug: row.provider_slug,
    providerDeliveryCostCents: row.provider_delivery_cost_cents,
    buyerDeliveryFeeCents: row.buyer_delivery_fee_cents,
    deliveryMarkupPercentageBps: row.delivery_markup_percentage_bps,
    deliveryMarkupAmountCents: row.delivery_markup_amount_cents,
    deliveryMarginCents: row.delivery_margin_cents,
    deliveryStatus: row.delivery_status,
    paymentStatus: row.payment_status,
  }));
}
