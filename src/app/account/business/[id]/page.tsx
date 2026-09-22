import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getBusinessForManage } from "@/server/business/getBusinessForManage";
import { getBusinessVerificationStatus } from "@/server/business/verification/getBusinessVerificationStatus";
import { getBusinessAvailableBalance } from "@/server/payouts/getBusinessAvailableBalance";
import { getBusinessPayouts } from "@/server/payouts/getBusinessPayouts";
import { formatCentsAsRand } from "@/server/listings/price";
import { BusinessProfileForm } from "./BusinessProfileForm";
import { BusinessLocationForm } from "./BusinessLocationForm";
import { BusinessVerificationForm } from "./BusinessVerificationForm";
import { RequestBusinessPayoutButton } from "./RequestBusinessPayoutButton";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted",
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
};

export default async function ManageBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/business/${id}`);

  const business = await getBusinessForManage(id);
  if (!business) notFound();

  const isOwner = business.ownerProfileId === user.id;

  const [verification, availableCents, payouts] = await Promise.all([
    getBusinessVerificationStatus(id),
    getBusinessAvailableBalance(id),
    getBusinessPayouts(id),
  ]);

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
        <h2 className="text-sm font-semibold text-brand-ink">Payouts</h2>
        <p className="text-xs text-brand-muted">
          Earnings from this business&apos;s completed orders, settled outside Bambini once marked paid. Payout speed
          depends on the settlement method Bambini uses — this is not an instant transfer.
        </p>

        <div className="flex flex-col gap-3 rounded-lg border border-brand-border bg-white p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand-muted">Available to withdraw</p>
            <p className="text-2xl font-semibold text-brand-ink">{formatCentsAsRand(availableCents)}</p>
          </div>
          {isOwner ? (
            availableCents > 0 ? (
              <RequestBusinessPayoutButton businessId={business.id} />
            ) : (
              <p className="text-xs text-brand-muted">Nothing available yet — this updates as orders are completed.</p>
            )
          ) : (
            <p className="text-xs text-brand-muted">Only the business owner can request a payout.</p>
          )}
        </div>

        {payouts.length > 0 && (
          <div className="flex flex-col gap-2">
            {payouts.map((p) => (
              <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-brand-ink">{formatCentsAsRand(p.amountCents)}</span>
                  <span className="text-xs capitalize text-brand-muted">{p.status}</span>
                </div>
                <p className="text-xs text-brand-muted">
                  {p.orderCount} order{p.orderCount === 1 ? "" : "s"} · Requested {new Date(p.createdAt).toLocaleDateString()}
                  {p.paidAt ? ` · Paid ${new Date(p.paidAt).toLocaleDateString()}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

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
