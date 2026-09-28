import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's real unread count (a head-only COUNT over the
 * partial unread index) for the header bell. Returns null — meaning "show
 * no badge" — for a signed-out visitor or if the count can't be read; the
 * bell must never show an invented or stale number, and a failed count
 * must never break the page it sits on.
 */
export async function getUnreadNotificationCount(userId: string | null): Promise<number | null> {
  if (!userId) return null;
  const supabase = await createClient();
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("profile_id", userId).is("read_at", null);
  if (error || count === null) return null;
  return count;
}
