"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead } from "@/server/notifications/actions";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export function MarkAllReadButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markAllNotificationsRead();
            if ("error" in result) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        Mark all as read
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
