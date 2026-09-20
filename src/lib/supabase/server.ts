import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";
import { getPublicEnv } from "@/config/env";

/**
 * Server client for use in Server Components, Route Handlers and Server
 * Actions. Still runs under the signed-in user's JWT (RLS applies) — this
 * is the anon-key client, not the service role client.
 */
export async function createClient() {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies — safe to
            // ignore as long as middleware is refreshing the session.
          }
        },
      },
    },
  );
}
