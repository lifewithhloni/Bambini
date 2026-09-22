"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type DisputeActionState = { error: string } | { success: true } | null;

const VALID_REASONS = [
  "item_not_received",
  "item_not_as_described",
  "damaged_item",
  "wrong_item",
  "delivery_problem",
  "collection_problem",
  "other",
] as const;

/**
 * open_dispute() is the real authorization/validation boundary — it
 * independently re-checks order.buyer_id = auth.uid() and the order's
 * eligibility state server-side. requireUser() is the same
 * UI-convenience gate every other authenticated-only action in this
 * codebase already uses. p_reason is validated against the same fixed
 * set the database enum enforces before ever reaching the RPC, purely
 * so a bad value gets a clean, humanized error instead of a raw
 * Postgres enum-cast error — the database's own dispute_reason type is
 * still the real, irreducible guarantee.
 */
export async function openDispute(orderId: string, _prev: DisputeActionState, formData: FormData): Promise<DisputeActionState> {
  await requireUser(`/account/orders/${orderId}`);
  const supabase = await createClient();

  const reason = String(formData.get("reason") ?? "");
  if (!(VALID_REASONS as readonly string[]).includes(reason)) {
    return { error: "Please choose a valid reason." };
  }
  const description = String(formData.get("description") ?? "").trim() || null;

  const { error } = await supabase.rpc("open_dispute", { p_order_id: orderId, p_reason: reason as (typeof VALID_REASONS)[number], p_description: description });
  if (error) return { error: humanizeDisputeError(error.message) };

  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath(`/sell/orders/${orderId}`);
  return { success: true };
}

/**
 * respond_to_dispute() is the real authorization/validation boundary —
 * it independently re-checks the caller is the order's seller (or, for
 * a business order, any member of it) and that the dispute is still
 * open/under review. requireUser() is a UI-convenience gate only.
 */
export async function respondToDispute(disputeId: string, orderId: string, _prev: DisputeActionState, formData: FormData): Promise<DisputeActionState> {
  await requireUser(`/sell/orders/${orderId}`);
  const supabase = await createClient();

  const response = String(formData.get("response") ?? "").trim();
  if (!response) return { error: "A response is required." };

  const { error } = await supabase.rpc("respond_to_dispute", { p_dispute_id: disputeId, p_response: response });
  if (error) return { error: humanizeDisputeError(error.message) };

  revalidatePath(`/sell/orders/${orderId}`);
  revalidatePath(`/account/orders/${orderId}`);
  return { success: true };
}

/**
 * resolve_dispute() is the real authorization/validation boundary — it
 * independently re-checks is_admin(), that p_outcome is one of the
 * three real resolution outcomes, and that the dispute is still
 * open/under review. Never moves money — see resolve_dispute()'s own
 * migration comment.
 */
export async function resolveDispute(disputeId: string, _prev: DisputeActionState, formData: FormData): Promise<DisputeActionState> {
  await requireAdmin("/admin/disputes");
  const supabase = await createClient();

  const outcome = String(formData.get("outcome") ?? "");
  if (!["resolved_buyer", "resolved_seller", "resolved_partial"].includes(outcome)) {
    return { error: "Please choose a valid outcome." };
  }
  const notes = String(formData.get("notes") ?? "").trim();
  if (!notes) return { error: "Resolution notes are required." };

  const { error } = await supabase.rpc("resolve_dispute", { p_dispute_id: disputeId, p_outcome: outcome as "resolved_buyer" | "resolved_seller" | "resolved_partial", p_resolution_notes: notes });
  if (error) return { error: humanizeDisputeError(error.message) };

  revalidatePath("/admin/disputes");
  revalidatePath(`/admin/disputes/${disputeId}`);
  return { success: true };
}

/** close_dispute() is the real authorization/validation boundary — admin-only, only reachable from an already-resolved dispute. */
export async function closeDispute(disputeId: string, _prev: DisputeActionState): Promise<DisputeActionState> {
  await requireAdmin("/admin/disputes");
  const supabase = await createClient();

  const { error } = await supabase.rpc("close_dispute", { p_dispute_id: disputeId });
  if (error) return { error: humanizeDisputeError(error.message) };

  revalidatePath("/admin/disputes");
  revalidatePath(`/admin/disputes/${disputeId}`);
  return { success: true };
}

function humanizeDisputeError(message?: string): string {
  if (!message) return "Could not complete this action. Please try again.";
  if (/only the buyer can open/i.test(message)) return "Only the buyer can open a dispute for this order.";
  if (/not eligible for a dispute/i.test(message)) return "This order isn't eligible for a dispute.";
  if (/already has an active dispute/i.test(message)) return "This order already has an active dispute.";
  if (/order not found/i.test(message)) return "Order not found.";
  if (/dispute not found/i.test(message)) return "Dispute not found.";
  if (/no longer open for a response/i.test(message)) return "This dispute is no longer open for a response.";
  if (/not authorized to respond/i.test(message)) return "You're not authorized to respond to this dispute.";
  if (/invalid resolution outcome/i.test(message)) return "Please choose a valid outcome.";
  if (/resolution notes are required/i.test(message)) return "Resolution notes are required.";
  if (/only an open or under-review dispute can be resolved/i.test(message)) return "Only an open or under-review dispute can be resolved.";
  if (/only a resolved dispute can be closed/i.test(message)) return "Only a resolved dispute can be closed.";
  if (/admin authorization required/i.test(message)) return "Admin authorization required.";
  if (/authentication required/i.test(message)) return "Please sign in and try again.";
  return "Could not complete this action. Please try again.";
}
