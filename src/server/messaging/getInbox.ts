import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCounterparts, type Counterpart } from "./counterpart";
import { contextFor, getListingContexts, type ListingContext } from "./listingContext";

/** Personal = threads where I'm the buyer or the individual seller. A business inbox is scoped to that ONE business — a member never sees personal threads there, or other businesses'. */
export type InboxScope = { kind: "personal" } | { kind: "business"; businessId: string };

export type InboxThread = {
  threadId: string;
  counterpart: Counterpart;
  listing: ListingContext;
  preview: { body: string; fromViewer: boolean; createdAt: string } | null;
  unread: boolean;
  lastMessageAt: string;
};

const MAX_THREADS = 50;

/**
 * The viewer's conversations, newest activity first. The threads read is
 * RLS-scoped (buyer, parent seller, or business member) and then narrowed
 * to the requested scope — never a broad read filtered in the browser.
 * THROWS on a failed read so the route's error boundary can show an error
 * state: an empty array must only ever mean "no conversations", never
 * "the query failed". Unread is real database state: a message from the
 * other side whose read_at is still null (for a business thread, shared by
 * every member — the first member to open it marks it read for the team).
 * Message bodies only ever appear as a one-message preview and are never
 * logged.
 */
export async function getInbox(viewerId: string, scope: InboxScope): Promise<InboxThread[]> {
  const supabase = await createClient();

  const base = supabase.from("message_threads").select("id, product_id, buyer_id, seller_type, seller_profile_id, business_id, last_message_at");
  const { data: threads, error } = await (scope.kind === "business"
    ? base.eq("business_id", scope.businessId)
    : base.or(`buyer_id.eq.${viewerId},seller_profile_id.eq.${viewerId}`)
  )
    .order("last_message_at", { ascending: false })
    .limit(MAX_THREADS);
  if (error) throw new Error(`Failed to load conversations: ${error.message}`);
  if (!threads || threads.length === 0) return [];

  const ids = threads.map((t) => t.id);

  const [counterparts, contexts, unreadResult, latestResults] = await Promise.all([
    getCounterparts(threads, viewerId),
    getListingContexts(threads.map((t) => t.product_id)),
    supabase.from("messages").select("thread_id").in("thread_id", ids).is("read_at", null).neq("sender_id", viewerId),
    Promise.all(
      ids.map((id) => supabase.from("messages").select("thread_id, sender_id, body, created_at").eq("thread_id", id).order("created_at", { ascending: false }).limit(1)),
    ),
  ]);
  if (unreadResult.error) throw new Error(`Failed to load conversations: ${unreadResult.error.message}`);
  const firstFailure = latestResults.find((r) => r.error);
  if (firstFailure?.error) throw new Error(`Failed to load conversations: ${firstFailure.error.message}`);

  const unreadThreadIds = new Set((unreadResult.data ?? []).map((m) => m.thread_id));
  const latestByThread = new Map(latestResults.map((r) => [r.data?.[0]?.thread_id, r.data?.[0]]));

  return threads.map((t) => {
    const latest = latestByThread.get(t.id);
    return {
      threadId: t.id,
      counterpart: counterparts.get(t.id) ?? { name: "Conversation", avatarUrl: null },
      listing: contextFor(contexts, t.product_id),
      preview: latest ? { body: latest.body, fromViewer: latest.sender_id === viewerId, createdAt: latest.created_at } : null,
      unread: unreadThreadIds.has(t.id),
      lastMessageAt: t.last_message_at,
    };
  });
}
