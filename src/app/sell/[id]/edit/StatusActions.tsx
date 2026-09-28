"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { changeListingStatus, deleteListing, type StatusActionResult } from "@/server/listings/actions";
import { canTransition, type ListingStatus } from "@/server/listings/statusTransitions";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export function StatusActions({ listingId, status, businessId }: { listingId: string; status: ListingStatus; businessId?: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [businessVerificationRequired, setBusinessVerificationRequired] = useState(false);
  const router = useRouter();

  function run(action: () => Promise<StatusActionResult>) {
    setError(null);
    setVerificationRequired(false);
    setBusinessVerificationRequired(false);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        setVerificationRequired(!!result.verificationRequired);
        setBusinessVerificationRequired(!!result.businessVerificationRequired);
      } else {
        router.refresh();
      }
    });
  }

  function runDelete() {
    if (!confirm("Delete this draft listing? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteListing(listingId);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push("/sell/listings");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canTransition(status, "published") && (
          <Button type="button" variant="primary" size="sm" disabled={isPending} onClick={() => run(() => changeListingStatus(listingId, "published"))}>
            Publish
          </Button>
        )}
        {canTransition(status, "draft") && (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => run(() => changeListingStatus(listingId, "draft"))}>
            {status === "published" ? "Unpublish" : "Restore to draft"}
          </Button>
        )}
        {canTransition(status, "archived") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (confirm("Archive this listing? It will no longer be visible to buyers.")) {
                run(() => changeListingStatus(listingId, "archived"));
              }
            }}
          >
            Archive
          </Button>
        )}
        {status === "draft" && (
          <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={runDelete}>
            Delete
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger">
          <div className="flex flex-col gap-1">
            <span>{error}</span>
            {verificationRequired && (
              <Link href="/account/verification" className="font-medium underline">
                Verify your account
              </Link>
            )}
            {businessVerificationRequired && businessId && (
              <Link href={`/account/business/${businessId}`} className="font-medium underline">
                Verify your business
              </Link>
            )}
          </div>
        </Alert>
      )}
    </div>
  );
}
