import "server-only";
import { Webhook } from "standardwebhooks";

/**
 * Verifies a Supabase Auth hook request per the Standard Webhooks spec
 * (the format Supabase documents for every HTTP hook), using the
 * `standardwebhooks` reference library rather than a hand-rolled scheme:
 *
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = HMAC-SHA256 with the base64-decoded secret, sent as
 *                    `v1,<base64>` (space-separated list allowed)
 *
 * The library compares signatures in constant time and rejects a
 * timestamp more than 5 minutes (300 s) from now in EITHER direction —
 * that is the replay window. Missing/malformed headers and a missing or
 * malformed secret all fail verification; nothing is ever "allowed
 * through" for want of configuration.
 *
 * `rawBody` must be the exact bytes Supabase sent (request.text()),
 * verified BEFORE any JSON parsing. Nothing here logs the body, the
 * headers, or the secret.
 */
export function verifySupabaseHookSignature(rawBody: string, headers: Headers, secret: string | null): boolean {
  if (!secret) return false;
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!id || !timestamp || !signature) return false;

  try {
    // Supabase gives the secret as "v1,whsec_<base64>"; the library wants the base64 part.
    const base64Secret = secret.replace(/^v1,whsec_/, "");
    if (base64Secret === "" || base64Secret === secret) return false; // not in Supabase's documented format
    const wh = new Webhook(base64Secret);
    wh.verify(rawBody, { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signature }, { jsonParse: false });
    return true;
  } catch {
    return false;
  }
}
