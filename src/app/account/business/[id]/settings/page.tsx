import Link from "next/link";
import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessVerificationStatus } from "@/server/business/verification/getBusinessVerificationStatus";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { BusinessProfileForm } from "../BusinessProfileForm";
import { BusinessLocationForm } from "../BusinessLocationForm";
import { BusinessVerificationForm } from "../BusinessVerificationForm";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

export const dynamic = "force-dynamic";

/**
 * Profile and collection-location editing are OWNER ONLY — the actual
 * boundary is businesses_update_owner_or_admin RLS (a column-level grant
 * on business_name/description/logo_url/location_id, owner_profile_id or
 * admin), so a team member's update would simply match zero rows. The
 * forms are therefore rendered for the owner alone and members see the
 * same information read-only, rather than a form that can only fail.
 * Verification submission stays exactly as before: any business member
 * may submit (business_verifications_insert = is_business_member()).
 */
export default async function BusinessSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}/settings`);
  const verification = await getBusinessVerificationStatus(id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Business profile</h2>
        {isOwner ? (
          <>
            <BusinessProfileForm businessId={business.id} businessName={business.businessName} description={business.description} />
            <BusinessLocationForm
              businessId={business.id}
              defaultValues={{ suburb: business.location?.suburb ?? undefined, city: business.location?.city ?? undefined }}
            />
          </>
        ) : (
          <>
            <Alert tone="info">Only the business owner can edit business settings.</Alert>
            <Card elevation="subtle">
              <div className="flex flex-col gap-1.5 text-body-small">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-brand-muted">Business name</span>
                  <span className="text-brand-ink">{business.businessName}</span>
                </div>
                {business.description && <p className="text-brand-ink">{business.description}</p>}
                {business.location?.suburb && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-brand-muted">Collection area</span>
                    <span className="text-brand-ink">{[business.location.suburb, business.location.city].filter(Boolean).join(", ")}</span>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Business verification</h2>

        {verification.status === "verified" && <Alert tone="success">This business is verified. Its storefront and listings are public.</Alert>}

        {verification.status === "rejected" && (
          <Alert tone="danger">
            <p>Your last submission was rejected{verification.rejectionReason ? `: ${verification.rejectionReason}` : "."}</p>
            <p className="mt-1">You can submit again below.</p>
          </Alert>
        )}

        {verification.status === "pending" && <Alert tone="info">Your submission is being reviewed.</Alert>}

        {verification.status === "not_submitted" && (
          <Alert tone="info">This business can&apos;t publish listings until it&apos;s verified. Submit its details below.</Alert>
        )}

        {(verification.status === "not_submitted" || verification.status === "rejected") && (
          <BusinessVerificationForm businessId={business.id} resubmission={verification.status === "rejected"} />
        )}

        {business.verificationStatus === "verified" && (
          <p className="text-caption text-brand-muted">
            Public storefront:{" "}
            <Link href={`/business/${business.slug}`} className="font-medium text-bambini-forest hover:underline">
              /business/{business.slug}
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
