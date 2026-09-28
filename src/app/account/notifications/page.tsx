import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getNotifications } from "@/server/notifications/getNotifications";
import { NotificationList } from "@/components/notifications/NotificationList";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Bell, ChevronLeft } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

// One specific signed-in user's own private notifications — never statically cached.
export const dynamic = "force-dynamic";

/**
 * The user's notifications, newest first, 50 per page (older ones via
 * "Show older"). A failed read throws to error.tsx — an empty list here
 * always genuinely means "nothing has happened yet". There is no
 * realtime: new notifications appear on refresh or navigation.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const user = await requireUser("/account/notifications");
  const { items, nextCursor } = await getNotifications(user.id, before);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <Link href="/account" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to account
      </Link>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-heading-page text-brand-ink">Notifications</h1>
        {items.some((n) => n.unread) && <MarkAllReadButton />}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Updates about your orders, payments, messages and account will show up here."
          action={
            <Link href="/search" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Browse items
            </Link>
          }
        />
      ) : (
        <>
          <NotificationList items={items} />
          {nextCursor && (
            <Link href={`/account/notifications?before=${encodeURIComponent(nextCursor)}`} className={buttonVariants({ variant: "outline", size: "sm", className: "self-center" })}>
              Show older
            </Link>
          )}
        </>
      )}
    </div>
  );
}
