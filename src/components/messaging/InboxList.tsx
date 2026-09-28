import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { messagePreview } from "@/lib/messaging/validation";
import type { InboxThread } from "@/server/messaging/getInbox";

/**
 * hrefBase is where a thread opens: /account/messages for the personal
 * inbox, /account/business/[id]/messages for one business's. "New" is real
 * database state (an unread message from the other side) and is stated in
 * text, not just weight or colour. Times come straight from the database.
 */
export function InboxList({ threads, hrefBase }: { threads: InboxThread[]; hrefBase: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {threads.map((t) => (
        <li key={t.threadId}>
          <Link href={`${hrefBase}/${t.threadId}`} className="block">
            <Card interactive>
              <div className="flex gap-3">
                <Avatar name={t.counterpart.name} imageUrl={t.counterpart.avatarUrl} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`truncate text-body-small text-brand-ink ${t.unread ? "font-semibold" : "font-medium"}`}>{t.counterpart.name}</p>
                    <time dateTime={t.lastMessageAt} className="shrink-0 text-caption text-brand-muted">
                      {new Date(t.lastMessageAt).toLocaleDateString()}
                    </time>
                  </div>
                  <p className="truncate text-caption text-brand-muted">
                    {t.listing.title ? `About: ${t.listing.title}` : "About a listing that's no longer available"}
                  </p>
                  {t.preview && (
                    <p className={`truncate text-body-small ${t.unread ? "text-brand-ink" : "text-brand-muted"}`}>
                      {t.preview.fromViewer ? "You: " : ""}
                      {messagePreview(t.preview.body)}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {t.unread && <Badge tone="accent">New</Badge>}
                    {t.listing.status === "sold" && <Badge tone="neutral">Sold</Badge>}
                    {t.listing.status === "unavailable" && <Badge tone="neutral">No longer available</Badge>}
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
