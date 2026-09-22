import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type CurrentDeliveryMarkupSetting = {
  markupPercentageBps: number;
  changedByName: string | null;
  effectiveFrom: string;
};

/**
 * Admin-only (requireAdmin() 404s otherwise) — delivery_markup_settings'
 * own RLS (delivery_markup_settings_select_admin) is the actual data
 * boundary, the same "UI convenience vs. real boundary" split every
 * other admin page in this codebase already uses. Reads the latest row
 * by effective_from — "current" is never anything other than the most
 * recent change (see the table's own migration comment on why this is
 * an append-only history, not a single mutable row).
 */
export async function getCurrentDeliveryMarkupSetting(): Promise<CurrentDeliveryMarkupSetting | null> {
  await requireAdmin("/admin/delivery/settings");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("delivery_markup_settings")
    .select("markup_percentage_bps, changed_by, effective_from")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  let changedByName: string | null = null;
  if (data.changed_by) {
    const { data: profile } = await supabase.from("profiles_public").select("full_name").eq("id", data.changed_by).maybeSingle();
    changedByName = profile?.full_name ?? null;
  }

  return {
    markupPercentageBps: data.markup_percentage_bps,
    changedByName,
    effectiveFrom: data.effective_from,
  };
}
