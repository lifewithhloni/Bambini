"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

/**
 * getInbox()/getThread() throw on a failed read instead of returning an
 * empty result — an empty inbox would be indistinguishable from "you have
 * no conversations", which would be a false statement about the user's own
 * data. This is the boundary that turns that throw into an honest retry.
 */
export default function MessagesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the error's own message — never message bodies, which no code path here ever puts in an error.
    console.error(error.message);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <ErrorState title="Couldn't load your messages." description="Please try again in a moment." onRetry={() => reset()} />
    </div>
  );
}
