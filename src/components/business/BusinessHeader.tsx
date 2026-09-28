import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { BusinessNav } from "./BusinessNav";
import { ChevronLeft } from "@/components/ui/icons";
import type { BadgeTone } from "@/lib/ui/variants";

const STATUS_LABELS: Record<string, string> = {
  not_submitted: "Not submitted",
  unverified: "Not verified",
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
};

const STATUS_TONES: Record<string, BadgeTone> = {
  not_submitted: "neutral",
  unverified: "neutral",
  pending: "warning",
  verified: "success",
  rejected: "danger",
};

export function BusinessVerificationBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{STATUS_LABELS[status] ?? status}</Badge>;
}

/**
 * Always names which business is being managed (a user can belong to more
 * than one — see getMyBusinesses()), and shows the caller's role in plain
 * words ("Owner" vs "Team member") derived from ownership only, never
 * from business_members.role.
 */
export function BusinessHeader({
  businessId,
  businessName,
  verificationStatus,
  isOwner,
}: {
  businessId: string;
  businessName: string;
  verificationStatus: string;
  isOwner: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/account/business" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All businesses
      </Link>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-heading-page text-brand-ink">{businessName}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <BusinessVerificationBadge status={verificationStatus} />
          <Badge tone="info">{isOwner ? "You're the owner" : "You're on the team"}</Badge>
        </div>
      </div>
      <BusinessNav businessId={businessId} />
    </div>
  );
}
