import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BusinessForManage = {
  id: string;
  businessName: string;
  slug: string;
  registrationNumber: string | null;
  vatNumber: string | null;
  description: string | null;
  logoUrl: string | null;
  verificationStatus: string;
  location: { suburb: string | null; city: string | null } | null;
  // Phase 8C — display-only, same caveat as getMyBusinesses()'s own
  // isOwner: any action that actually needs the ownership check
  // (e.g. request_business_payout()) re-derives it server-side/RLS
  // regardless of what this says.
  ownerProfileId: string;
};

/**
 * Relies on businesses_select_member_or_admin RLS — a business id that
 * exists but isn't one the caller owns/manages returns null here
 * exactly like one that doesn't exist, the same not-found-vs-not-yours
 * privacy pattern getOrder()/getListingForEdit() already use.
 */
export async function getBusinessForManage(businessId: string): Promise<BusinessForManage | null> {
  const supabase = await createClient();

  const { data: business, error } = await supabase
    .from("businesses")
    .select("id, business_name, slug, registration_number, vat_number, description, logo_url, verification_status, location_id, owner_profile_id")
    .eq("id", businessId)
    .maybeSingle();

  if (error || !business) return null;

  let location: BusinessForManage["location"] = null;
  if (business.location_id) {
    const { data } = await supabase.from("locations").select("suburb, city").eq("id", business.location_id).maybeSingle();
    location = data ?? null;
  }

  return {
    id: business.id,
    businessName: business.business_name,
    slug: business.slug,
    registrationNumber: business.registration_number,
    vatNumber: business.vat_number,
    description: business.description,
    logoUrl: business.logo_url,
    verificationStatus: business.verification_status,
    location,
    ownerProfileId: business.owner_profile_id,
  };
}
