"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath, signInSchema, signUpSchema } from "./validation";

export type AuthActionState = { error: string } | null;

/**
 * Every field here comes from the form the user submitted — there is no
 * user id anywhere in this input. Supabase Auth derives the id, and the
 * `handle_new_user()` database trigger creates the matching `profiles`
 * row (role defaults to 'parent') in the same transaction as the
 * auth.users insert, so there's no window where an account exists
 * without a profile, and no client-supplied id for the trigger to trust.
 */
export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) {
    return { error: error.message };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signIn(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately generic — confirming "that email isn't registered"
    // vs. "wrong password" lets an attacker enumerate accounts.
    return { error: "Incorrect email or password." };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
