"use client";

import Link from "next/link";
import { markNotificationRead } from "@/server/notifications/actions";

/**
 * The tappable part of one notification. Following the link marks it read
 * through the server action (fire-and-forget: navigation never waits on it,
 * and a failure never blocks it); the read state itself lives in the
 * database. With no link (unknown destination) it renders plain content.
 * The visible content — title, body, time, "New" — is server-rendered and
 * passed in as children, so this holds no notification state of its own.
 */
export function NotificationLink({ notificationId, href, unread, children }: { notificationId: string; href: string | null; unread: boolean; children: React.ReactNode }) {
  if (!href) return <div className="block">{children}</div>;

  return (
    <Link
      href={href}
      className="block rounded-card"
      onClick={() => {
        if (unread) void markNotificationRead(notificationId);
      }}
    >
      {children}
    </Link>
  );
}
