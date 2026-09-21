import { z } from "zod";

/**
 * Server-side env schema. Import this (not `process.env` directly) anywhere
 * business logic needs a config value, so missing/malformed config fails
 * fast at startup instead of surfacing as a runtime bug deep in a handler.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_CURRENCY: z.string().default("ZAR"),
  PAYMENT_PROVIDER: z.string().default("mock"),
  // Optional at the schema level — only actually required once
  // PAYMENT_PROVIDER=payfast, checked at first use by
  // getPayFastCredentials() (src/server/payments/providers/payfast/config.ts),
  // not here, so selecting "mock" (the default) never demands PayFast
  // credentials exist at all.
  PAYFAST_MERCHANT_ID: z.string().optional(),
  PAYFAST_MERCHANT_KEY: z.string().optional(),
  PAYFAST_PASSPHRASE: z.string().optional(),
  // "false" (string, since all env vars are strings) selects the live
  // PayFast host; anything else — including unset — stays sandbox. See
  // getPayFastHosts() for why the safer default is sandbox, not live.
  PAYFAST_SANDBOX: z.string().optional(),
  DELIVERY_PROVIDERS: z.string().default("mock"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Lazily validated so this module can be imported from client bundles
 * (e.g. via a shared type) without throwing for vars that only exist
 * on the server.
 */
export function getServerEnv(): ServerEnv {
  if (!cached) {
    cached = serverEnvSchema.parse(process.env);
  }
  return cached;
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_CURRENCY: z.string().default("ZAR"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Safe to call from client components — only exposes NEXT_PUBLIC_* vars. */
export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_DEFAULT_CURRENCY: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY,
  });
}
