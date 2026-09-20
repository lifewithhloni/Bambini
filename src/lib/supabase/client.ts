import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { getPublicEnv } from "@/config/env";

/**
 * Browser client for use in Client Components. Runs under the signed-in
 * user's JWT, so every query is subject to Row Level Security — this
 * client must never be given the service role key.
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
