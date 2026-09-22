"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";
import { requireUser } from "@/server/auth/requireUser";

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

/**
 * recover_failed_payout() is the real authorization/validation boundary
 * (independently re-checks is_admin(), status = 'failed', non-empty
 * reason, locks the payout + its payout_items rows). This action does
 * NOT create a new payout — recovery only supersedes the old
 * payout_items claims so their orders become eligible again; a separate,
 * explicit createPayout() call is required afterwards, same as every
 * other admin-initiated financial step in this codebase.
 */
export async function recoverPayout(payoutId: string, _prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  await requireAdmin("/admin/payouts");
  const supabase = await createClient();

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A recovery reason is required." };

  const { error } = await supabase.rpc("recover_failed_payout", { p_payout_id: payoutId, p_reason: reason });
  if (error) return { error: humanizePayoutError(error.message) };

  revalidatePath("/admin/payouts");
  return { success: true };
}

/**
 * request_seller_payout() is the real authorization/validation boundary
 * — it independently re-derives auth.uid() as the seller, locks and
 * re-derives the eligible orders and total server-side, and takes no
 * arguments at all. requireUser() here is the same UI-convenience gate
 * every other authenticated-only action in this codebase already uses —
 * never trusted as the real check. The client never supplies an amount,
 * an order id, a payout id, or a seller id; there is nothing for it to
 * supply, by construction.
 */
export async function requestPayout(_prev: PayoutActionState): Promise<PayoutActionState> {
  await requireUser("/sell/payouts");
  const supabase = await createClient();

  const { error } = await supabase.rpc("request_seller_payout");
  if (error) return { error: humanizePayoutError(error.message) };

  revalidatePath("/sell/payouts");
  return { success: true };
}

/**
 * request_business_payout() is the real authorization/validation
 * boundary — it independently re-checks that auth.uid() is the
 * business's owner (never just any member — see this function's own
 * migration comment for that reasoning), locks and re-derives the
 * eligible orders and total server-side. businessId here is only ever a
 * lookup key, never trusted on its own: the RPC rejects it outright if
 * the caller doesn't actually own that business. requireUser() is the
 * same UI-convenience gate every other authenticated-only action in
 * this codebase already uses — never the real check.
 */
export async function requestBusinessPayout(businessId: string, _prev: PayoutActionState): Promise<PayoutActionState> {
  await requireUser(`/account/business/${businessId}`);
  const supabase = await createClient();

  const { error } = await supabase.rpc("request_business_payout", { p_business_id: businessId });
  if (error) return { error: humanizePayoutError(error.message) };

  revalidatePath(`/account/business/${businessId}`);
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
  if (/already been recovered/i.test(message)) return "This payout has already been recovered.";
  if (/only a failed payout can be recovered/i.test(message)) return "Only a failed payout can be recovered.";
  if (/recovery reason is required/i.test(message)) return "A recovery reason is required.";
  if (/recovered payout cannot be marked as paid/i.test(message)) return "A recovered payout can't be marked as paid — create a new payout instead.";
  if (/recovered payout cannot be marked as failed/i.test(message)) return "A recovered payout can't be marked as failed.";
  if (/no eligible earnings/i.test(message)) return "You have no available earnings to withdraw right now.";
  if (/authentication required/i.test(message)) return "Please sign in and try again.";
  if (/only the business owner can request/i.test(message)) return "Only the business owner can request a payout.";
  if (/not authorized to view this business/i.test(message)) return "You don't have access to this business's balance.";
  if (/not found/i.test(message)) return "One or more orders were not found.";
  return "Could not complete this action. Please try again.";
}
