"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type PayoutActionState = { error: string } | { success: true } | null;

/**
 * create_seller_payout() is the actual authorization/validation
 * boundary — it independently re-checks is_admin(), that every order is
 * online + completed + belongs to one seller, and that none is already
 * paid out, all inside one transaction. requireAdmin() here is the same
 * UI-convenience gate every other admin action in this codebase already
 * uses (see reviewVerificationAction.ts) — never trusted as the real
 * check. orderIds always come from this server action's own argument
 * (bound server-side from the admin page's own already-computed
 * eligible-orders list), never read out of client-supplied form data as
 * anything financially authoritative.
 */
export async function createPayout(orderIds: string[], _prev: PayoutActionState): Promise<PayoutActionState> {
  await requireAdmin("/admin/payouts");
  const supabase = await createClient();

  const { error } = await supabase.rpc("create_seller_payout", { p_order_ids: orderIds });
  if (error) return { error: humanizePayoutError(error.message) };

  revalidatePath("/admin/payouts");
  return { success: true };
}

export async function markPayoutPaid(payoutId: string, _prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  await requireAdmin("/admin/payouts");
  const supabase = await createClient();

  const providerReference = String(formData.get("providerReference") ?? "").trim() || null;

  const { error } = await supabase.rpc("mark_payout_paid", { p_payout_id: payoutId, p_provider_reference: providerReference });
  if (error) return { error: humanizePayoutError(error.message) };

  revalidatePath("/admin/payouts");
  return { success: true };
}

export async function markPayoutFailed(payoutId: string, _prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  await requireAdmin("/admin/payouts");
  const supabase = await createClient();

  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { error } = await supabase.rpc("mark_payout_failed", { p_payout_id: payoutId, p_notes: notes });
  if (error) return { error: humanizePayoutError(error.message) };

  revalidatePath("/admin/payouts");
  return { success: true };
}

function humanizePayoutError(message?: string): string {
  if (!message) return "Could not complete this action. Please try again.";
  if (/already been paid out/i.test(message)) return "One or more of these orders have already been paid out.";
  if (/must be completed/i.test(message)) return "Every order must be completed before it's eligible for payout.";
  if (/only online orders/i.test(message)) return "Cash orders are not eligible for payout.";
  if (/same seller/i.test(message)) return "All orders in a payout must belong to the same seller.";
  if (/already been marked as paid/i.test(message)) return "This payout has already been marked as paid.";
  if (/failed payout cannot be marked as paid/i.test(message)) return "A failed payout can't be marked as paid directly.";
  if (/paid payout cannot be marked as failed/i.test(message)) return "A paid payout can't be marked as failed.";
  if (/payout not found/i.test(message)) return "Payout not found.";
  if (/not found/i.test(message)) return "One or more orders were not found.";
  return "Could not complete this action. Please try again.";
}
