import Link from "next/link";
import { Bell } from "@/components/ui/icons";
import { getUnreadNotificationCount } from "@/server/notifications/getUnreadCount";

/**
 * The header entry point to /account/notifications, for signed-in users
 * only. The badge is the database's real unread count (see
 * getUnreadNotificationCount) and is simply absent when the count is zero
 * or couldn't be read — never a guess. The unread state is also in the
 * accessible name, so it isn't conveyed by the visual badge alone.
 */
export async function NotificationBell({ userId }: { userId: string }) {
  const count = await getUnreadNotificationCount(userId);
  const label = count ? `Notifications, ${count} unread` : "Notifications";

  return (
    <Link
      href="/account/notifications"
      aria-label={label}
      className="relative -mx-1.5 flex h-11 w-11 items-center justify-center rounded-full text-brand-ink transition-colors duration-150 ease-bambini hover:bg-brand-cream hover:text-bambini-forest"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {count ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bambini-coral px-1 text-[10px] font-semibold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
