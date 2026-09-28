import { notFound } from "next/navigation";
import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getThread } from "@/server/messaging/getThread";
import { ThreadView } from "@/components/messaging/ThreadView";

export const dynamic = "force-dynamic";

/**
 * Two independent server checks, neither trusting the URL: the caller must
 * be the owner or a member of THIS business (requireBusinessAccess()), and
 * the conversation must belong to this business (getThread() is RLS-scoped
 * to participants and, in business scope, requires the thread's
 * business_id to equal the route's id). A member of another business, or
 * this business's own member reaching for a personal thread, gets a 404.
 */
export default async function BusinessThreadPage({ params }: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await params;
  const { userId } = await requireBusinessAccess(id, `/account/business/${id}/messages/${threadId}`);

  const thread = await getThread(threadId, userId, { kind: "business", businessId: id });
  if (!thread) notFound();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 sm:py-12">
      <ThreadView thread={thread} backHref={`/account/business/${id}/messages`} />
    </div>
  );
}
