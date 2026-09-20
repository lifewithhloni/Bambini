import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";
import { getPublicEnv } from "@/config/env";

/**
 * Refreshes the Supabase auth session cookie on every request. Server
 * Components can't write cookies, so without this, sessions would expire
 * silently instead of refreshing. Called from the root proxy.ts.
 *
 * Deliberately tolerant of missing Supabase config: this runs on every
 * request, so if NEXT_PUBLIC_SUPABASE_* isn't set yet (e.g. exploring the
 * UI before `supabase start`/project setup), auth-independent pages must
 * still render rather than every route 500ing on a config error. A page
 * that actually needs a signed-in user will fail explicitly when it
 * tries to use the Supabase client, which is the right place for that.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  let env;
  try {
    env = getPublicEnv();
  } catch {
    return response;
  }

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Required: revalidates the token with Supabase Auth on every request.
  await supabase.auth.getUser();

  return response;
}
