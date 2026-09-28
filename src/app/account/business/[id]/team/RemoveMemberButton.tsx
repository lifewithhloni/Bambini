"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeBusinessMember } from "@/server/business/actions";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

/** Only ever rendered for the business owner (see the team page); removeBusinessMember() is owner-only via business_members_delete_owner_or_admin RLS regardless. */
export function RemoveMemberButton({ businessId, profileId, displayName }: { businessId: string; profileId: string; displayName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onRemove() {
    if (!confirm(`Remove ${displayName} from this business? They will lose access to its listings and orders.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeBusinessMember(businessId, profileId);
      if (result && "error" in result) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button type="button" variant="outline" size="sm" loading={isPending} onClick={onRemove}>
        Remove
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
