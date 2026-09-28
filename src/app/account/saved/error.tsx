"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

/**
 * getSavedItems() throws on a failed read rather than returning an empty
 * list — an empty list would be indistinguishable from "you haven't saved
 * anything", which would be a false statement about the user's own data.
 * This is the route-level boundary that turns that throw into an honest
 * retry state.
 */
export default function SavedItemsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <ErrorState title="Couldn't load your saved items." description="Please try again in a moment." onRetry={() => reset()} />
    </div>
  );
}
