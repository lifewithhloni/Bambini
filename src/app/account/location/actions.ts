"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { locationSchema } from "@/server/location/validation";

export type UpdateLocationState = { error: string } | { success: true } | null;

/**
 * One location row per seller, reused as both "where I collect from" (for
 * listings offering collection — see resolveOwnPickupLocationId() in
 * src/server/listings/actions.ts) and "where I'm browsing from" (Nearby's
 * reference point). If the caller already has a saved location
 * (profiles.location_id), this updates that row in place rather than
 * creating a new one each time — same identity, refreshed coordinates.
 * Coordinates are only ever written here from the client's explicit "Use
 * my current location" action (see LocationForm.tsx) — this action itself
 * has no idea where they came from and doesn't need to; it only validates
 * range and persists.
 */
export async function updateLocation(_prev: UpdateLocationState, formData: FormData): Promise<UpdateLocationState> {
  const user = await requireUser();

  const parsed = locationSchema.safeParse({
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    suburb: formData.get("suburb"),
    city: formData.get("city"),
    province: formData.get("province"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("location_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return { error: "Could not save your location. Please try again." };
  }

  const locationFields = {
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    suburb: parsed.data.suburb,
    city: parsed.data.city,
    province: parsed.data.province,
  };

  if (profile?.location_id) {
    const { error } = await supabase.from("locations").update(locationFields).eq("id", profile.location_id);
    if (error) {
      return { error: "Could not save your location. Please try again." };
    }
  } else {
    const { data: location, error } = await supabase
      .from("locations")
      .insert({ created_by: user.id, ...locationFields })
      .select("id")
      .single();
    if (error || !location) {
      return { error: "Could not save your location. Please try again." };
    }

    const { error: linkError } = await supabase.from("profiles").update({ location_id: location.id }).eq("id", user.id);
    if (linkError) {
      return { error: "Could not save your location. Please try again." };
    }
  }

  revalidatePath("/account/location");
  revalidatePath("/nearby");
  revalidatePath("/sell");
  return { success: true };
}
