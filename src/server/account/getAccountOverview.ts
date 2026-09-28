import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getMyBusinesses, type MyBusiness } from "@/server/business/getMyBusinesses";

export type AccountOverview = {
  fullName: string;
  phone: string | null;
  memberSince: string;
  /** Approximate area only (suburb/city) — never coordinates, a street address, or the location row's id. */
  savedArea: { suburb: string | null; city: string | null } | null;
  businesses: MyBusiness[];
};

/**
 * Everything the /account hub shows, resolved for the signed-in user's own
 * id (from requireUser(), never a form field). profiles and locations are
 * owner-only under RLS (profiles_select_own_or_admin,
 * locations_select_own_or_admin), so the .eq("id", userId) here is defense
 * in depth, not the boundary. Selects an explicit minimal column list —
 * notably no role tier, no verification columns (identity state lives on
 * /account/verification, sourced from identity_verifications), no
 * avatar/location ids, and only suburb/city from the location row.
 * Returns null when the profile can't be read, so the page can show one
 * honest error state instead of a half-empty hub.
 */
export async function getAccountOverview(userId: string): Promise<AccountOverview | null> {
  const supabase = await createClient();

  const { data: profile, error } = await supabase.from("profiles").select("full_name, phone, created_at, location_id").eq("id", userId).single();
  if (error || !profile) return null;

  let savedArea: AccountOverview["savedArea"] = null;
  if (profile.location_id) {
    const { data: location } = await supabase.from("locations").select("suburb, city").eq("id", profile.location_id).maybeSingle();
    savedArea = location ? { suburb: location.suburb, city: location.city } : null;
  }

  const businesses = await getMyBusinesses(userId);

  return { fullName: profile.full_name, phone: profile.phone, memberSince: profile.created_at, savedArea, businesses };
}
