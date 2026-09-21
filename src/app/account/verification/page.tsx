import Link from "next/link";
import { getVerificationStatus, PHONE_VERIFICATION_AVAILABLE } from "@/server/verification/getVerificationStatus";
import { VerificationForm } from "./VerificationForm";

// One specific signed-in user's own verification state — never statically cached.
export const dynamic = "force-dynamic";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-brand-sage-dark/20 text-brand-sage-dark" : "bg-brand-border text-brand-ink"
      }`}
    >
      {label}
    </span>
  );
}

export default async function VerificationPage() {
  const status = await getVerificationStatus();

  const identityLabel: Record<typeof status.identityStatus, string> = {
    not_submitted: "Not submitted",
    pending: "Pending review",
    verified: "Verified",
    rejected: "Rejected",
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Verification</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Buying and selling on Bambini requires a fully verified account. Browsing and searching never require this.
        </p>
      </div>

      {status.canTransact && (
        <p role="status" className="rounded-lg bg-brand-sage/20 px-3 py-2 text-sm text-brand-ink">
          You&apos;re fully verified — you can buy and sell.
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-4">
        <h2 className="text-sm font-semibold text-brand-ink">Account verification</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-brand-muted">Email</span>
          <StatusPill ok={status.emailConfirmed} label={status.emailConfirmed ? "Verified" : "Not verified"} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-brand-muted">Phone</span>
          {PHONE_VERIFICATION_AVAILABLE ? (
            <StatusPill ok={status.phoneConfirmed} label={status.phoneConfirmed ? "Verified" : "Not verified"} />
          ) : (
            <span className="inline-flex items-center rounded-full bg-brand-border px-2.5 py-0.5 text-xs font-medium text-brand-muted">
              Currently unavailable
            </span>
          )}
        </div>
        {!PHONE_VERIFICATION_AVAILABLE && (
          <p className="text-xs text-brand-muted">
            Phone verification isn&apos;t configured on Bambini yet. This isn&apos;t something you need to do — it&apos;s on our
            side.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-brand-ink">Identity verification</h2>

        <div className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-4 text-sm">
          <span className="text-brand-muted">Status</span>
          <StatusPill ok={status.identityStatus === "verified"} label={identityLabel[status.identityStatus]} />
        </div>

        {status.identityStatus === "rejected" && (
          <div className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
            <p>Your last submission was rejected{status.rejectionReason ? `: ${status.rejectionReason}` : "."}</p>
            <p className="mt-1">You can submit again below.</p>
          </div>
        )}

        {status.identityStatus === "pending" && (
          <p className="rounded-lg bg-brand-border px-3 py-2 text-sm text-brand-ink">
            Your submission is being reviewed. This usually doesn&apos;t take long.
          </p>
        )}

        {(status.identityStatus === "not_submitted" || status.identityStatus === "rejected") && (
          <VerificationForm resubmission={status.identityStatus === "rejected"} />
        )}
      </section>

      <Link href="/account" className="text-center text-sm text-brand-muted hover:underline">
        Back to account
      </Link>
    </div>
  );
}
