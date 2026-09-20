"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { updateProfileSchema } from "@/server/auth/validation";

export type UpdateProfileState = { error: string } | { success: true } | null;

/**
 * The row to update is always the signed-in user's own — `user.id` comes
 * from `requireUser()` (which re-verifies the session against Supabase
 * Auth), never from the submitted form. Even if that scoping were
 * somehow wrong, RLS (`profiles_update_own_or_admin`) plus the
 * column-level GRANT restricting writable columns to
 * full_name/avatar_url/phone/location_id are the actual, database-level
 * enforcement — this query being correctly scoped is defense in depth,
 * not the security boundary itself.
 */
export async function updateProfile(_prev: UpdateProfileState, formData: FormData): Promise<UpdateProfileState> {
  const user = await requireUser();

  const parsed = updateProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
    .eq("id", user.id);

  if (error) {
    return { error: "Could not update your profile. Please try again." };
  }

  revalidatePath("/account");
  return { success: true };
}
