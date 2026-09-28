"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

/** Same honesty rule as the personal inbox: a failed read is an error state, never an empty "no messages" list. */
export default function BusinessMessagesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error.message);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <ErrorState title="Couldn't load your business messages." description="Please try again in a moment." onRetry={() => reset()} />
    </div>
  );
}
