import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ChevronLeft } from "@/components/ui/icons";
import { MessageComposer } from "./MessageComposer";
import { MarkThreadRead } from "./MarkThreadRead";
import type { ThreadDetail, MessageSender } from "@/server/messaging/getThread";

/**
 * One conversation, server-rendered from getThread(). Who sent each
 * message is stated in TEXT above every bubble (never bubble colour or
 * side alone), message text renders as plain text with whitespace kept
 * and long words wrapped, and no user ids appear anywhere. The listing
 * context links to the listing only while it's still published; a sold
 * one is labelled as such and an archived/deleted one just says it's no
 * longer available.
 */
export function ThreadView({ thread, backHref }: { thread: ThreadDetail; backHref: string }) {
  const label = (sender: MessageSender) => (sender === "you" ? "You" : sender === "teammate" ? "Your team" : thread.counterpart.name);

  return (
    <div className="flex flex-col gap-4">
      <MarkThreadRead threadId={thread.threadId} />

      <Link href={backHref} className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All messages
      </Link>

      <header className="flex items-center gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
        <Avatar name={thread.counterpart.name} imageUrl={thread.counterpart.avatarUrl} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-heading-card text-brand-ink">{thread.counterpart.name}</h1>
          {thread.listing.href && thread.listing.title ? (
            <Link href={thread.listing.href} className="truncate text-caption text-bambini-forest hover:underline">
              About: {thread.listing.title}
            </Link>
          ) : thread.listing.title ? (
            <p className="truncate text-caption text-brand-muted">About: {thread.listing.title}</p>
          ) : (
            <p className="text-caption text-brand-muted">About a listing that&apos;s no longer available</p>
          )}
        </div>
        {thread.listing.status === "sold" && <Badge tone="neutral">Sold</Badge>}
        {thread.listing.status === "unavailable" && <Badge tone="neutral">No longer available</Badge>}
      </header>

      {thread.messages.length === 0 ? (
        <p className="py-8 text-center text-body-small text-brand-muted">No messages yet. Start the conversation.</p>
      ) : (
        <ol aria-label="Messages" className="flex flex-col gap-3">
          {thread.messages.map((m) => (
            <li key={m.id} className={`flex flex-col gap-0.5 ${m.sender === "you" ? "items-end" : "items-start"}`}>
              <p className="text-caption text-brand-muted">
                <span className="font-medium text-brand-ink">{label(m.sender)}</span> · <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>
              </p>
              <p
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-body-small text-brand-ink ${
                  m.sender === "you" ? "bg-brand-light-sage" : "border border-brand-border bg-brand-surface"
                }`}
              >
                {m.body}
              </p>
            </li>
          ))}
        </ol>
      )}

      <MessageComposer threadId={thread.threadId} />
    </div>
  );
}
