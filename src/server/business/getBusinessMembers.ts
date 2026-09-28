import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BusinessMember = {
  /** The membership row's own profile id — only ever used as the key for the owner-only "remove" action, never rendered as text. */
  profileId: string;
  displayName: string;
};

/**
 * business_members_select lets any member of the business (or admin) read
 * its member rows — the same is_business_member() scope every other
 * business read uses, so a non-member gets zero rows, never an error.
 * Names come only from profiles_public (a display name, nothing private).
 * `business_members.role` is deliberately NOT selected: it's a free-text
 * column no policy or function treats as an authorization tier, so
 * surfacing it in the UI would invite exactly the "staff vs manager"
 * permission reading the schema doesn't actually enforce. The business
 * owner is not a business_members row (ownership is
 * businesses.owner_profile_id), so this list is only ever additional
 * team members.
 */
export async function getBusinessMembers(businessId: string): Promise<BusinessMember[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase.from("business_members").select("profile_id, created_at").eq("business_id", businessId).order("created_at", { ascending: true });
  if (error || !rows || rows.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles_public")
    .select("id, full_name")
    .in(
      "id",
      rows.map((r) => r.profile_id),
    );
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({ profileId: r.profile_id, displayName: nameById.get(r.profile_id) ?? "Team member" }));
}
