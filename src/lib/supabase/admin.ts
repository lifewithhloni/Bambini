import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerEnv } from "@/config/env";

/**
 * Service-role client. Bypasses Row Level Security entirely, so it must
 * only be used for operations that have already done their own
 * authorization check server-side (e.g. computing a payout, recording a
 * platform-triggered transaction event). The `server-only` import makes
 * accidentally bundling this into client code a build-time error.
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
