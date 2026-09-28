import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getThread } from "@/server/messaging/getThread";
import { ThreadView } from "@/components/messaging/ThreadView";

// One specific signed-in user's own private conversation — never statically cached.
export const dynamic = "force-dynamic";

/**
 * The thread id in the URL is only a lookup key: getThread() is RLS-scoped
 * to participants AND to this personal scope (buyer or individual seller),
 * so anyone else — a stranger, an unrelated business member — gets the
 * same 404 as a thread that doesn't exist.
 */
export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const user = await requireUser(`/account/messages/${threadId}`);

  const thread = await getThread(threadId, user.id, { kind: "personal" });
  if (!thread) notFound();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 sm:py-12">
      <ThreadView thread={thread} backHref="/account/messages" />
    </div>
  );
}
