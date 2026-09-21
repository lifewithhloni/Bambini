import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MyBusiness = {
  id: string;
  businessName: string;
  slug: string;
  verificationStatus: string;
  isOwner: boolean;
};

/**
 * businesses_select_member_or_admin RLS would also let an admin's plain
 * SELECT return every business in the system — fine for RLS's own
 * purpose, wrong for this specific "my businesses" list, which must
 * only ever show what this user actually owns or belongs to (the same
 * explicit-filter-on-top-of-RLS pattern getMyListings() already uses).
 * isOwner is display-only; every action that actually needs an
 * ownership check re-derives it server-side/via RLS at that point.
 */
export async function getMyBusinesses(userId: string): Promise<MyBusiness[]> {
  const supabase = await createClient();

  const { data: memberRows } = await supabase.from("business_members").select("business_id").eq("profile_id", userId);
  const memberBusinessIds = (memberRows ?? []).map((m) => m.business_id);

  const orFilter =
    memberBusinessIds.length > 0
      ? `owner_profile_id.eq.${userId},id.in.(${memberBusinessIds.join(",")})`
      : `owner_profile_id.eq.${userId}`;

  const { data } = await supabase
    .from("businesses")
    .select("id, business_name, slug, verification_status, owner_profile_id")
    .or(orFilter);

  return (data ?? []).map((b) => ({
    id: b.id,
    businessName: b.business_name,
    slug: b.slug,
    verificationStatus: b.verification_status,
    isOwner: b.owner_profile_id === userId,
  }));
}
