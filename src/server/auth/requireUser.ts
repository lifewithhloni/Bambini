import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The authoritative gate for a protected Server Component or Server
 * Action. Always re-verifies the session against Supabase Auth
 * (`getUser()`, not `getSession()` — the latter only decodes the local
 * cookie without checking it's still valid) rather than trusting
 * anything the caller passes in, so a protected page can never be
 * reached by forging a client-side value.
 *
 * Deliberately not relied on via middleware alone: proxy.ts only
 * refreshes the session cookie. Authorization for a specific page lives
 * in that page, per Supabase's guidance, so a misconfigured middleware
 * matcher can't accidentally leave a route unprotected.
 */
export async function requireUser(currentPath?: string): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const target = currentPath ? `/login?next=${encodeURIComponent(currentPath)}` : "/login";
    redirect(target);
  }

  return user;
}

/**
 * For UI that adapts to sign-in state but must never fail the page it's
 * on — the site header, for instance, renders on every route including
 * statically-generated public pages, so it must degrade to "logged out"
 * rather than take the whole page down if Supabase env vars are absent
 * (e.g. mid-build) or briefly unreachable. Never use this where the
 * caller actually needs to gate access — that's what requireUser() is for.
 */
export async function getOptionalUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
