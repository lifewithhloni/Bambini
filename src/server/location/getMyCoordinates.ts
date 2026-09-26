import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";

/**
 * The signed-in user's own saved coordinates, resolved server-side from
 * their profile's location_id — never browser geolocation (this project
 * deliberately doesn't auto-request it; see /account/location for the
 * only way a location gets set) and never returned to the client as raw
 * numbers beyond what the caller itself does with them. Returns null
 * for a signed-out visitor, or a signed-in user with no saved location
 * yet — both are "nearby has nothing to show" cases, not errors.
 * Extracted from /nearby/page.tsx's own original inline lookup so the
 * Phase 11 homepage's nearby teaser doesn't duplicate the same
 * two-step profile → location query.
 */
export async function getMyCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  const user = await getOptionalUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("location_id").eq("id", user.id).maybeSingle();
  if (!profile?.location_id) return null;

  const { data: location } = await supabase.from("locations").select("latitude, longitude").eq("id", profile.location_id).maybeSingle();
  if (!location) return null;

  return { latitude: location.latitude, longitude: location.longitude };
}
