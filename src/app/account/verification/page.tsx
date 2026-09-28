import Link from "next/link";
import { getVerificationStatus, PHONE_VERIFICATION_AVAILABLE } from "@/server/verification/getVerificationStatus";
import { VerificationForm } from "./VerificationForm";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { ChevronLeft, Check } from "@/components/ui/icons";
import type { BadgeTone } from "@/lib/ui/variants";

// One specific signed-in user's own verification state — never statically cached.
export const dynamic = "force-dynamic";

const IDENTITY_LABELS = { not_submitted: "Not submitted", pending: "Pending review", verified: "Verified", rejected: "Rejected" } as const;
const IDENTITY_TONES: Record<keyof typeof IDENTITY_LABELS, BadgeTone> = { not_submitted: "neutral", pending: "warning", verified: "success", rejected: "danger" };

/**
 * Two distinct things, kept visibly separate: ACCOUNT verification (email
 * and phone, straight from Supabase Auth) and IDENTITY verification (the
 * manual-review ID check, from identity_verifications — never the legacy
 * profiles.account_verification column). The rejection reason is shown
 * only for a rejected submission: the admin review form labels that
 * field "shown to the user if rejected", i.e. it's written to be read by
 * the applicant. The ID number, document path, and reviewer are never
 * selected by getVerificationStatus() at all.
 */
export default async function VerificationPage() {
  const status = await getVerificationStatus();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <Link href="/account" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to account
      </Link>

      <div>
        <h1 className="text-heading-page text-brand-ink">Verification</h1>
        <p className="mt-1 text-body-small text-brand-muted">
          Buying and selling on Bambini requires a fully verified account. Browsing and searching never require this.
        </p>
      </div>

      {status.canTransact && <Alert tone="success">You&apos;re fully verified — you can buy and sell.</Alert>}

      <Card>
        <h2 className="mb-3 text-heading-card text-brand-ink">Account verification</h2>
        <div className="flex flex-col gap-2 text-body-small">
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Email</span>
            <Badge tone={status.emailConfirmed ? "success" : "neutral"}>
              {status.emailConfirmed && <Check className="h-3 w-3" aria-hidden="true" />}
              {status.emailConfirmed ? "Verified" : "Not verified"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Phone</span>
            {PHONE_VERIFICATION_AVAILABLE ? (
              <Badge tone={status.phoneConfirmed ? "success" : "neutral"}>{status.phoneConfirmed ? "Verified" : "Not verified"}</Badge>
            ) : (
              <Badge tone="neutral">Currently unavailable</Badge>
            )}
          </div>
          {!PHONE_VERIFICATION_AVAILABLE && (
            <p className="text-caption text-brand-muted">
              Phone verification isn&apos;t configured on Bambini yet. This isn&apos;t something you need to do — it&apos;s on our side.
            </p>
          )}
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Identity verification</h2>

        <Card>
          <div className="flex items-center justify-between text-body-small">
            <span className="text-brand-muted">Status</span>
            <Badge tone={IDENTITY_TONES[status.identityStatus]}>
              {status.identityStatus === "verified" && <Check className="h-3 w-3" aria-hidden="true" />}
              {IDENTITY_LABELS[status.identityStatus]}
            </Badge>
          </div>
        </Card>

        {status.identityStatus === "rejected" && (
          <Alert tone="danger">
            <p>Your last submission was rejected{status.rejectionReason ? `: ${status.rejectionReason}` : "."}</p>
            <p className="mt-1">You can submit again below.</p>
          </Alert>
        )}

        {status.identityStatus === "pending" && <Alert tone="info">Your submission is being reviewed. This usually doesn&apos;t take long.</Alert>}

        {(status.identityStatus === "not_submitted" || status.identityStatus === "rejected") && (
          <VerificationForm resubmission={status.identityStatus === "rejected"} />
        )}
      </section>
    </div>
  );
}
