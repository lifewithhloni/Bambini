"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { createBusinessSchema, updateBusinessSchema } from "./validation";

export type BusinessActionState = { error: string } | null;

/**
 * owner_profile_id is never taken from the form — it's always
 * requireUser()'s own verified id. This is defense in depth on top of
 * (not a substitute for) businesses_insert_own's own `with check
 * (owner_profile_id = auth.uid())` — a client sending a different id
 * here would be rejected by RLS regardless, but this action never even
 * gives it the chance. verification_status/account_standing/rating_*
 * are excluded from the column-level INSERT grant entirely (see
 * 20260920100000_restrict_insert_columns.sql) — a business always
 * starts 'unverified' no matter what a client sends.
 */
export async function createBusiness(_prev: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  const user = await requireUser("/account/business/new");

  const parsed = createBusinessSchema.safeParse({
    businessName: formData.get("businessName"),
    slug: formData.get("slug"),
    registrationNumber: formData.get("registrationNumber"),
    vatNumber: formData.get("vatNumber"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();
  const { data: business, error } = await supabase
    .from("businesses")
    .insert({
      owner_profile_id: user.id,
      business_name: parsed.data.businessName,
      slug: parsed.data.slug,
      registration_number: parsed.data.registrationNumber,
      vat_number: parsed.data.vatNumber,
      description: parsed.data.description,
    })
    .select("id")
    .single();

  if (error || !business) {
    return { error: humanizeBusinessError(error?.message) };
  }

  revalidatePath("/account/business");
  redirect(`/account/business/${business.id}`);
}

/** Scoped to a business the signed-in user owns via RLS — 0 rows affected means "not found or not yours," reported identically so a stranger can't probe which business ids exist (same pattern as updateListing()). */
export async function updateBusiness(businessId: string, _prev: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  await requireUser(`/account/business/${businessId}`);

  const parsed = updateBusinessSchema.safeParse({
    businessName: formData.get("businessName"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("businesses")
    .update({ business_name: parsed.data.businessName, description: parsed.data.description })
    .eq("id", businessId)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { error: "Business not found." };
  }

  revalidatePath(`/account/business/${businessId}`);
  revalidatePath("/account/business");
  return null;
}

/**
 * Owner-only, enforced by business_members_delete_owner_or_admin RLS (the
 * business's owner_profile_id, or admin) — never by "any member" and never
 * by business_members.role. A non-owner's delete simply matches 0 rows,
 * which is reported identically to "not found" so this can't be used to
 * probe membership. Both ids arrive from this action's own bound
 * arguments/the row the owner clicked on, but neither is trusted for
 * authorization: RLS re-derives ownership from auth.uid() regardless.
 */
export async function removeBusinessMember(businessId: string, profileId: string): Promise<BusinessActionState> {
  await requireUser(`/account/business/${businessId}/team`);

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("business_members")
    .delete()
    .eq("business_id", businessId)
    .eq("profile_id", profileId)
    .select("profile_id");

  if (error || !removed || removed.length === 0) {
    return { error: "Could not remove this team member." };
  }

  revalidatePath(`/account/business/${businessId}/team`);
  return null;
}

function humanizeBusinessError(message?: string): string {
  if (!message) return "Could not create your business. Please try again.";
  if (/businesses_slug_key|duplicate key.*slug/i.test(message)) return "That URL is already taken — choose another.";
  if (/businesses_slug_format/i.test(message)) return "Use only lowercase letters, numbers, and hyphens for the URL.";
  return "Could not create your business. Please try again.";
}
