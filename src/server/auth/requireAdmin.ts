import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "./requireUser";

/**
 * The first admin-gated route this codebase has (Phase 5's minimal
 * verification-review surface) — reuses is_admin()'s own underlying
 * fact (profiles.role = 'admin') rather than introducing any new role
 * concept. Deliberately 404s rather than redirecting to login/showing a
 * "forbidden" page — a non-admin (including a signed-out user, via
 * requireUser()'s own redirect) should not be able to tell this route
 * exists at all, the same not-found-vs-not-yours privacy pattern
 * getOrder()/getPublicListing() already use elsewhere in this codebase.
 * This is a UI convenience layer only — every actual privileged read or
 * write on this page still goes through its own is_admin()-checked RLS
 * policy or SECURITY DEFINER function; this check is not the security
 * boundary by itself.
 */
export async function requireAdmin(currentPath?: string) {
  const user = await requireUser(currentPath);

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();

  if (profile?.role !== "admin") {
    notFound();
  }

  return user;
}
