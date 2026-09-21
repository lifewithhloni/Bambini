"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { changeListingStatus, deleteListing, type StatusActionResult } from "@/server/listings/actions";
import { canTransition, type ListingStatus } from "@/server/listings/statusTransitions";

const buttonClass =
  "rounded-full border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-white disabled:opacity-50";
const primaryButtonClass =
  "rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50";
const dangerButtonClass =
  "rounded-full border border-brand-danger px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10 disabled:opacity-50";

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
        router.push("/sell");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canTransition(status, "published") && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => changeListingStatus(listingId, "published"))}
            className={primaryButtonClass}
          >
            Publish
          </button>
        )}
        {canTransition(status, "draft") && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => changeListingStatus(listingId, "draft"))}
            className={buttonClass}
          >
            {status === "published" ? "Unpublish" : "Restore to draft"}
          </button>
        )}
        {canTransition(status, "archived") && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm("Archive this listing? It will no longer be visible to buyers.")) {
                run(() => changeListingStatus(listingId, "archived"));
              }
            }}
            className={buttonClass}
          >
            Archive
          </button>
        )}
        {status === "draft" && (
          <button type="button" disabled={isPending} onClick={runDelete} className={dangerButtonClass}>
            Delete
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          <p>{error}</p>
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
      )}
    </div>
  );
}
