import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getBusinessForManage } from "@/server/business/getBusinessForManage";
import { getBusinessVerificationStatus } from "@/server/business/verification/getBusinessVerificationStatus";
import { BusinessProfileForm } from "./BusinessProfileForm";
import { BusinessLocationForm } from "./BusinessLocationForm";
import { BusinessVerificationForm } from "./BusinessVerificationForm";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted",
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
};

export default async function ManageBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser(`/account/business/${id}`);

  const business = await getBusinessForManage(id);
  if (!business) notFound();

  const verification = await getBusinessVerificationStatus(id);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">{business.businessName}</h1>
        <p className="mt-1 text-sm text-brand-muted">
          {business.verificationStatus === "verified" ? (
            <>
              Public storefront:{" "}
              <Link href={`/business/${business.slug}`} className="font-medium text-brand-ink underline">
                /business/{business.slug}
              </Link>
            </>
          ) : (
            "Your storefront and listings become public once this business is verified."
          )}
        </p>
      </div>

      <BusinessProfileForm businessId={business.id} businessName={business.businessName} description={business.description} />

      <BusinessLocationForm
        businessId={business.id}
        defaultValues={{ suburb: business.location?.suburb ?? undefined, city: business.location?.city ?? undefined }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-brand-ink">Business verification</h2>
        <div className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-4 text-sm">
          <span className="text-brand-muted">Status</span>
          <span className="text-brand-ink">{STATUS_LABEL[verification.status]}</span>
        </div>

        {verification.status === "rejected" && (
          <div className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
            <p>Your last submission was rejected{verification.rejectionReason ? `: ${verification.rejectionReason}` : "."}</p>
            <p className="mt-1">You can submit again below.</p>
          </div>
        )}

        {verification.status === "pending" && (
          <p className="rounded-lg bg-brand-border px-3 py-2 text-sm text-brand-ink">Your submission is being reviewed.</p>
        )}

        {(verification.status === "not_submitted" || verification.status === "rejected") && (
          <BusinessVerificationForm businessId={business.id} resubmission={verification.status === "rejected"} />
        )}
      </section>

      <Link href="/account/business" className="text-center text-sm text-brand-muted hover:underline">
        Back to your businesses
      </Link>
    </div>
  );
}
