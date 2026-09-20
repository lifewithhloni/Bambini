import "server-only";
import { createClient } from "@/lib/supabase/server";

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

/**
 * The bucket is private (see supabase/config.toml) so an <img> tag can't
 * just point at a stable public URL — every read goes through RLS via a
 * signed URL, generated here using the *viewer's* session (the server
 * client carries their cookies), so a signed URL for a draft listing's
 * photo can only ever be minted for someone RLS already lets see it.
 */
export async function getSignedImageUrls(storagePaths: string[]): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("product-images")
    .createSignedUrls(storagePaths, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && !entry.error) {
      map[entry.path ?? ""] = entry.signedUrl;
    }
  }
  return map;
}
