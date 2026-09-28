"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/server/auth/requireUser";
import { normalizeMessageBody } from "@/lib/messaging/validation";

export type StartConversationResult = { threadId: string } | { error: string; authRequired?: boolean };
export type SendMessageResult = { ok: true } | { error: string; authRequired?: boolean };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every identity here is derived server-side: the buyer is the signed-in
 * user, and the seller/business is read from the PRODUCT row itself — the
 * client supplies only a listing id and message text, so it can never name
 * a participant, a business, or a listing context. message_threads'
 * insert policy re-verifies all of it in the database (published product,
 * seller matches the product, buyer isn't that seller/business member);
 * the self-message check below is for a friendly error, not the boundary.
 * A conversation exists only after this explicit action — viewing a listing
 * never creates one. One thread per buyer per listing is enforced by a
 * unique index, so a repeat or concurrent call reuses the existing thread
 * (INSERT ... ON CONFLICT DO NOTHING, then read it back). Message bodies
 * are never logged.
 */
export async function startConversation(productId: string, rawBody: string): Promise<StartConversationResult> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in to message the seller.", authRequired: true };
  if (!UUID_PATTERN.test(productId)) return { error: "This listing isn't available to message about." };

  const parsed = normalizeMessageBody(rawBody);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, seller_type, seller_profile_id, business_id")
    .eq("id", productId)
    .eq("status", "published")
    .maybeSingle();
  if (!product) return { error: "This listing isn't available to message about." };

  let isOwnListing = product.seller_type === "parent" && product.seller_profile_id === user.id;
  if (!isOwnListing && product.seller_type === "business" && product.business_id) {
    const [{ data: owned }, { data: member }] = await Promise.all([
      supabase.from("businesses").select("id").eq("id", product.business_id).eq("owner_profile_id", user.id).maybeSingle(),
      supabase.from("business_members").select("business_id").eq("business_id", product.business_id).eq("profile_id", user.id).maybeSingle(),
    ]);
    isOwnListing = !!owned || !!member;
  }
  if (isOwnListing) return { error: "You can't message yourself about your own listing." };

  const { error: threadError } = await supabase.from("message_threads").upsert(
    {
      product_id: product.id,
      buyer_id: user.id,
      seller_type: product.seller_type,
      seller_profile_id: product.seller_profile_id,
      business_id: product.business_id,
    },
    { onConflict: "buyer_id,product_id", ignoreDuplicates: true },
  );
  if (threadError) return { error: "Couldn't start the conversation. Please try again." };

  const { data: thread } = await supabase.from("message_threads").select("id").eq("buyer_id", user.id).eq("product_id", product.id).maybeSingle();
  if (!thread) return { error: "Couldn't start the conversation. Please try again." };

  const { error: messageError } = await supabase.from("messages").insert({ thread_id: thread.id, sender_id: user.id, body: parsed.body });
  if (messageError) return { error: "Couldn't send your message. Please try again." };

  revalidatePath("/account/messages");
  return { threadId: thread.id };
}

/**
 * The sender is always the signed-in user. Participation in the thread
 * (buyer, parent seller, or a member of the selling business) is enforced
 * by messages_insert_participant RLS, so a non-participant's insert simply
 * fails — reported as a generic send failure, never confirming the thread
 * exists. created_at/read_at are database-set (column grants), and the
 * body's length/blank rules are also CHECK constraints.
 */
export async function sendMessage(threadId: string, rawBody: string): Promise<SendMessageResult> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in to send messages.", authRequired: true };
  if (!UUID_PATTERN.test(threadId)) return { error: "Couldn't send your message." };

  const parsed = normalizeMessageBody(rawBody);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({ thread_id: threadId, sender_id: user.id, body: parsed.body });
  if (error) return { error: "Couldn't send your message. Please try again." };

  revalidatePath("/account/messages");
  return { ok: true };
}

/**
 * Marks the OTHER side's unread messages in this thread as read. Recipient
 * only, enforced by messages_update_recipient_mark_read RLS plus a
 * read_at-only column grant — a sender can never mark their own message
 * read, and nothing else about a message is changeable. Best-effort by
 * design: failing to mark read must never break opening a conversation.
 */
export async function markThreadRead(threadId: string): Promise<void> {
  const user = await getOptionalUser();
  if (!user || !UUID_PATTERN.test(threadId)) return;

  const supabase = await createClient();
  await supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("thread_id", threadId).neq("sender_id", user.id).is("read_at", null);

  revalidatePath("/account/messages");
}
