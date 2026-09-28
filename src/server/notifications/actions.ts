"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarkReadResult = { ok: true } | { error: string };

/**
 * Marking read is the ONLY thing a client can do to a notification. The
 * recipient is the signed-in user (explicit profile_id filter, and RLS +
 * a read_at-only column grant enforce it independently); the timestamp is
 * set by the database (a trigger), never sent from here, and a read
 * notification can never be marked unread again. Notifications are created
 * exclusively by database triggers — there is deliberately no create action.
 */
export async function markNotificationRead(notificationId: string): Promise<MarkReadResult> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in to manage your notifications." };
  if (!UUID_PATTERN.test(notificationId)) return { error: "Couldn't update this notification." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("profile_id", user.id)
    .is("read_at", null);
  if (error) return { error: "Couldn't update this notification." };

  // The layout too: the header bell's unread count lives in it.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<MarkReadResult> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in to manage your notifications." };

  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", user.id).is("read_at", null);
  if (error) return { error: "Couldn't update your notifications." };

  revalidatePath("/", "layout");
  return { ok: true };
}
