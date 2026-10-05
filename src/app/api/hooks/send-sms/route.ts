import { handleSendSmsHook } from "@/server/phone/hook/handleSendSmsHook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Supabase Auth "Send SMS" hook endpoint (server-to-server; there is no
 * browser session here — authenticity is the Standard Webhooks signature,
 * checked inside the handler). Deliberately excluded from src/proxy.ts so
 * no Supabase session refresh adds latency to a hook with a 5 s budget.
 * All logic and its documentation live in handleSendSmsHook.
 */
export async function POST(request: Request): Promise<Response> {
  return handleSendSmsHook(request);
}
