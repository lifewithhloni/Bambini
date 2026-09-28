import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getInbox } from "@/server/messaging/getInbox";
import { InboxList } from "@/components/messaging/InboxList";
import { EmptyState } from "@/components/ui/EmptyState";
import { MessageCircle, ChevronLeft } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

// One specific signed-in user's own private conversations — never statically cached.
export const dynamic = "force-dynamic";

/**
 * The personal inbox: conversations where the user is the buyer or the
 * individual seller. Business conversations live under each business
 * (/account/business/[id]/messages) so a business member is never handed
 * another context's messages here. A failed read throws to error.tsx —
 * an empty inbox here always genuinely means "no conversations".
 */
export default async function MessagesPage() {
  const user = await requireUser("/account/messages");
  const threads = await getInbox(user.id, { kind: "personal" });

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <Link href="/account" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to account
      </Link>

      <h1 className="text-heading-page text-brand-ink">Messages</h1>

      {threads.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No messages yet"
          description="Message a seller from any listing and your conversations will show up here."
          action={
            <Link href="/search" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Browse items
            </Link>
          }
        />
      ) : (
        <InboxList threads={threads} hrefBase="/account/messages" />
      )}
    </div>
  );
}
