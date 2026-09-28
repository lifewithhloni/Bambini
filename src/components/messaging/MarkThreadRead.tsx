"use client";

import { useEffect } from "react";
import { markThreadRead } from "@/server/messaging/actions";

/**
 * Opening a conversation marks the other side's messages read. The state
 * lives in the database (messages.read_at, recipient-only by RLS + a
 * read_at-only column grant) — this component only triggers the server
 * action once on mount; it holds no read state of its own, and renders
 * nothing. Failure is silent by design: not being able to mark a message
 * read must never get in the way of reading it.
 */
export function MarkThreadRead({ threadId }: { threadId: string }) {
  useEffect(() => {
    void markThreadRead(threadId);
  }, [threadId]);
  return null;
}
