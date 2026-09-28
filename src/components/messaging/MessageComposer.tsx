"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/server/messaging/actions";
import { MAX_MESSAGE_LENGTH } from "@/lib/messaging/validation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

/**
 * Plain multiline text. Enter inserts a newline as normal; Ctrl/Cmd+Enter
 * (or the Send button) sends — a deliberate choice so a stray Enter on a
 * phone keyboard never fires off half a message. The server action is the
 * authority on who may send and on the body rules; on success this just
 * clears the box and refreshes the server-rendered conversation, and on
 * failure the text stays so nothing typed is lost.
 */
export function MessageComposer({ threadId }: { threadId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fieldId = useId();

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessage(threadId, body);
      if ("error" in result) {
        if (result.authRequired) {
          router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        setError(result.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={fieldId} className="text-body-small font-medium text-brand-ink">
        Message
      </label>
      <textarea
        id={fieldId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Write a message…"
        className={inputVariants()}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-brand-muted">Ctrl or ⌘ + Enter to send</p>
        <Button type="submit" variant="primary" size="sm" loading={isPending} disabled={body.trim().length === 0}>
          {isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
