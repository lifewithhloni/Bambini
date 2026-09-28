"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startConversation } from "@/server/messaging/actions";
import { MAX_MESSAGE_LENGTH } from "@/lib/messaging/validation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { MessageCircle } from "@/components/ui/icons";
import { inputVariants } from "@/lib/ui/variants";

/**
 * The listing page's "Message seller". Nothing is created until the
 * visitor sends a first message — merely viewing a listing, or opening
 * this form, creates no conversation. Signed-out visitors are sent to sign
 * in and returned here (no anonymous conversations exist). If the buyer
 * already has a conversation about this listing they're offered
 * "Continue conversation" instead, so they can't start a second one. This
 * component is never rendered for the listing's own seller (the page
 * checks ownership, and startConversation() independently refuses it).
 */
export function MessageSellerForm({
  productId,
  signedIn,
  existingThreadId,
}: {
  productId: string;
  signedIn: boolean;
  existingThreadId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const fieldId = useId();

  if (existingThreadId) {
    return (
      <Link href={`/account/messages/${existingThreadId}`} className="inline-flex h-11 w-fit items-center gap-2 rounded-button border border-brand-border bg-brand-surface px-4 text-button text-brand-ink transition-colors duration-150 ease-bambini hover:bg-brand-cream">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        Continue conversation
      </Link>
    );
  }

  function goToLogin() {
    router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => (signedIn ? setOpen(true) : goToLogin())} className="w-fit">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        Message seller
      </Button>
    );
  }

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await startConversation(productId, body);
      if ("error" in result) {
        if (result.authRequired) {
          goToLogin();
          return;
        }
        setError(result.error);
        return;
      }
      router.push(`/account/messages/${result.threadId}`);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2 rounded-card border border-brand-border bg-brand-surface p-3"
    >
      <label htmlFor={fieldId} className="text-body-small font-medium text-brand-ink">
        Message the seller
      </label>
      <textarea
        id={fieldId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Hi, is this still available?"
        className={inputVariants()}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={isPending} disabled={body.trim().length === 0}>
          {isPending ? "Sending…" : "Send message"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
