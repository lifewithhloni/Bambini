"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { locationSchema } from "@/server/location/validation";

export type UpdateBusinessLocationState = { error: string } | { success: true } | null;

/**
 * Mirrors src/app/account/location/actions.ts's updateLocation() exactly,
 * scoped to a business's own location_id instead of the caller's own
 * profile — reuses the same locations table, never a second location
 * system (per DECISIONS.md's existing "one location per seller"
 * principle, extended to "one location per business"). The actual
 * authorization boundary is businesses_update_owner_or_admin RLS
 * (owner-only, not any business_member — see the RLS migration): a
 * non-owner's final `.update({location_id})` simply matches 0 rows.
 * `created_by = user.id` on the locations row (never the business
 * itself) matches every other locations write in this schema — the
 * acting individual creates the record, the business references it.
 */
export async function updateBusinessLocation(businessId: string, _prev: UpdateBusinessLocationState, formData: FormData): Promise<UpdateBusinessLocationState> {
  const user = await requireUser(`/account/business/${businessId}`);

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

  const { data: business, error: businessError } = await supabase.from("businesses").select("location_id").eq("id", businessId).maybeSingle();
  if (businessError || !business) {
    return { error: "Business not found." };
  }

  const locationFields = {
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    suburb: parsed.data.suburb,
    city: parsed.data.city,
    province: parsed.data.province,
  };

  let locationId = business.location_id;
  if (locationId) {
    const { error } = await supabase.from("locations").update(locationFields).eq("id", locationId);
    if (error) return { error: "Could not save the business location. Please try again." };
  } else {
    const { data: location, error } = await supabase.from("locations").insert({ created_by: user.id, ...locationFields }).select("id").single();
    if (error || !location) return { error: "Could not save the business location. Please try again." };
    locationId = location.id;
  }

  const { data: updated, error: linkError } = await supabase
    .from("businesses")
    .update({ location_id: locationId })
    .eq("id", businessId)
    .select("id")
    .maybeSingle();
  if (linkError || !updated) {
    return { error: "Could not save the business location. Please try again." };
  }

  revalidatePath(`/account/business/${businessId}`);
  return { success: true };
}
