import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Bell, ChevronRight, CreditCard, Banknote, MessageCircle, PackageCheck, ShoppingBag, Truck, Check } from "@/components/ui/icons";
import type { ComponentType } from "react";
import { NotificationLink } from "./NotificationLink";
import type { NotificationItem } from "@/server/notifications/getNotifications";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const ICONS: Record<string, IconType> = {
  order_updated: ShoppingBag,
  payment_updated: CreditCard,
  delivery_updated: Truck,
  dispute_updated: PackageCheck,
  message_received: MessageCircle,
  verification_updated: Check,
  payout_updated: Banknote,
};

/**
 * Server-rendered: titles, bodies and times come straight from the database
 * rows. "New" is real read_at state and is stated in text (and in the
 * visually hidden prefix for screen readers), never colour or weight alone.
 * Each row is one real link to the relevant existing page.
 */
export function NotificationList({ items }: { items: NotificationItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((n) => {
        const Icon = ICONS[n.type] ?? Bell;
        return (
          <li key={n.id}>
            <NotificationLink notificationId={n.id} href={n.href} unread={n.unread}>
              <Card interactive={n.href !== null}>
                <div className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light-sage">
                    <Icon className="h-4 w-4 text-bambini-forest" aria-hidden={true} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-body-small text-brand-ink ${n.unread ? "font-semibold" : "font-medium"}`}>
                        {n.unread && <span className="sr-only">Unread: </span>}
                        {n.title}
                      </p>
                      <time dateTime={n.createdAt} className="shrink-0 text-caption text-brand-muted">
                        {new Date(n.createdAt).toLocaleDateString()}
                      </time>
                    </div>
                    {n.body && <p className={`text-body-small ${n.unread ? "text-brand-ink" : "text-brand-muted"}`}>{n.body}</p>}
                    {n.unread && (
                      <div className="mt-1">
                        <Badge tone="accent">New</Badge>
                      </div>
                    )}
                  </div>
                  {n.href && <ChevronRight className="mt-2 h-4 w-4 shrink-0 self-start text-brand-muted" aria-hidden="true" />}
                </div>
              </Card>
            </NotificationLink>
          </li>
        );
      })}
    </ul>
  );
}
