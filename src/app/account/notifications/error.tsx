"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

/**
 * getNotifications() throws on a failed read instead of returning an empty
 * page — an empty list would falsely tell the user nothing has happened.
 * This is the boundary that turns that throw into an honest retry.
 */
export default function NotificationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error.message);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <ErrorState title="Couldn't load your notifications." description="Please try again in a moment." onRetry={() => reset()} />
    </div>
  );
}
