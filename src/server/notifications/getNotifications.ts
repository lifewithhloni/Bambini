import "server-only";
import { createClient } from "@/lib/supabase/server";
import { NOTIFICATIONS_PAGE_SIZE, decodeCursor, encodeCursor, notificationHref } from "@/lib/notifications/notifications";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  unread: boolean;
  createdAt: string;
};

export type NotificationsPage = { items: NotificationItem[]; nextCursor: string | null };

/**
 * One page (50) of the viewer's own notifications, newest first. Scoped by
 * the explicit profile_id filter AND by RLS (auth.uid()). THROWS on a
 * failed read so the route's error boundary can show an error state — an
 * empty page must only ever mean "no notifications", never "the query
 * failed". Paging is keyset-based on (created_at, id) so a burst of
 * notifications created in one transaction can't be skipped or repeated
 * between pages. Unread is the database's own read_at, nothing client-side.
 */
export async function getNotifications(viewerId: string, rawCursor?: string): Promise<NotificationsPage> {
  const supabase = await createClient();
  const cursor = decodeCursor(rawCursor);

  let query = supabase
    .from("notifications")
    .select("id, type, title, body, data, read_at, created_at")
    .eq("profile_id", viewerId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(NOTIFICATIONS_PAGE_SIZE + 1);
  if (cursor) {
    query = query.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load notifications: ${error.message}`);

  const rows = data ?? [];
  const page = rows.slice(0, NOTIFICATIONS_PAGE_SIZE);
  const last = page[page.length - 1];

  return {
    items: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: notificationHref(n.type, n.data ?? {}),
      unread: n.read_at === null,
      createdAt: n.created_at,
    })),
    nextCursor: rows.length > NOTIFICATIONS_PAGE_SIZE && last ? encodeCursor(last.created_at, last.id) : null,
  };
}
