"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type UpdateMarkupState = { error: string } | { success: true } | null;

/**
 * The RPC (update_delivery_markup_setting()) is the actual authorization
 * and validation boundary — it independently re-checks is_admin() from
 * auth.uid() and re-validates the bounds server-side, never trusting
 * this action or the form it came from. requireAdmin() here is the same
 * UI-convenience gate every other admin action in this codebase already
 * uses (see reviewVerificationAction.ts).
 */
export async function updateDeliveryMarkup(_prev: UpdateMarkupState, formData: FormData): Promise<UpdateMarkupState> {
  await requireAdmin("/admin/delivery/settings");

  const raw = formData.get("markupPercentage");
  const parsed = Number(raw);
  if (typeof raw !== "string" || raw.trim() === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    return { error: "Enter a whole-number percentage between 0 and 100." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_delivery_markup_setting", { p_markup_percentage_bps: parsed * 100 });

  if (error) {
    return { error: humanizeUpdateMarkupError(error.message) };
  }

  revalidatePath("/admin/delivery/settings");
  return { success: true };
}

function humanizeUpdateMarkupError(message?: string): string {
  if (!message) return "Could not save the markup percentage. Please try again.";
  if (/between 0%.*100%|between 0 and 10000/i.test(message)) return "Enter a percentage between 0 and 100.";
  if (/admin authorization required/i.test(message)) return "Admin authorization required.";
  return "Could not save the markup percentage. Please try again.";
}
