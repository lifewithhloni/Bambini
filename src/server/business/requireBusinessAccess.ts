import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getBusinessForManage, type BusinessForManage } from "./getBusinessForManage";

/**
 * The single entry gate for every /account/business/[id]/* page: signs the
 * caller in, then resolves the business through getBusinessForManage() —
 * whose RLS read (businesses_select_member_or_admin) returns null for a
 * business the caller neither owns nor belongs to, which becomes an
 * ordinary 404 here, indistinguishable from a nonexistent id. The
 * businessId in the URL is therefore only ever a lookup key, never an
 * authorization claim. isOwner is derived from the row's own
 * owner_profile_id (the same single ownership source every owner-only
 * action re-derives server-side/RLS regardless) — never from
 * business_members.role, which no policy treats as a permission tier.
 */
export async function requireBusinessAccess(businessId: string, returnPath: string): Promise<{ userId: string; business: BusinessForManage; isOwner: boolean }> {
  const user = await requireUser(returnPath);
  const business = await getBusinessForManage(businessId);
  if (!business) notFound();
  return { userId: user.id, business, isOwner: business.ownerProfileId === user.id };
}
