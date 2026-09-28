import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCounterparts, type Counterpart } from "./counterpart";
import { contextFor, getListingContexts, type ListingContext } from "./listingContext";
import type { InboxScope } from "./getInbox";

/** "you" = sent by the viewer; "teammate" = another member of the viewer's own business; "them" = the other party. No user ids are ever exposed. */
export type MessageSender = "you" | "teammate" | "them";

export type ThreadMessage = { id: string; sender: MessageSender; body: string; createdAt: string };

export type ThreadDetail = {
  threadId: string;
  counterpart: Counterpart;
  listing: ListingContext;
  messages: ThreadMessage[];
};

const MAX_MESSAGES = 200;

/**
 * One conversation, or null. null covers "doesn't exist", "not yours"
 * (the read is RLS-scoped to participants) and "not in this scope" —
 * indistinguishable by design, so a thread id can't be probed. The scope
 * is enforced here as well as by RLS: the personal route only serves
 * threads where the viewer is the buyer or the individual seller, and a
 * business route only that business's threads, so a business member can't
 * reach a personal thread (or another business's) through a business URL,
 * nor a personal-seller thread through the business one. Throws on a
 * failed messages read rather than showing a misleading empty chat.
 */
export async function getThread(threadId: string, viewerId: string, scope: InboxScope): Promise<ThreadDetail | null> {
  const supabase = await createClient();

  const { data: thread, error } = await supabase
    .from("message_threads")
    .select("id, product_id, buyer_id, seller_type, seller_profile_id, business_id")
    .eq("id", threadId)
    .maybeSingle();
  if (error || !thread) return null;

  const inScope =
    scope.kind === "business" ? thread.business_id === scope.businessId : thread.buyer_id === viewerId || thread.seller_profile_id === viewerId;
  if (!inScope) return null;

  const { data: rows, error: messagesError } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);
  if (messagesError) throw new Error(`Failed to load messages: ${messagesError.message}`);

  const [counterparts, contexts] = await Promise.all([getCounterparts([thread], viewerId), getListingContexts([thread.product_id])]);

  const viewerIsBuyer = thread.buyer_id === viewerId;
  const messages: ThreadMessage[] = [...(rows ?? [])].reverse().map((m) => {
    let sender: MessageSender;
    if (m.sender_id === viewerId) sender = "you";
    else if (!viewerIsBuyer && m.sender_id !== thread.buyer_id) sender = "teammate";
    else sender = "them";
    return { id: m.id, sender, body: m.body, createdAt: m.created_at };
  });

  return {
    threadId: thread.id,
    counterpart: counterparts.get(thread.id) ?? { name: viewerIsBuyer ? "Seller" : "Buyer", avatarUrl: null },
    listing: contextFor(contexts, thread.product_id),
    messages,
  };
}
