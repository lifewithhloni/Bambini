import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getAccountOverview } from "@/server/account/getAccountOverview";
import { getVerificationStatus } from "@/server/verification/getVerificationStatus";
import { BUYER_ORDERS_HREF, BUSINESSES_HREF, LOCATION_HREF, SELLER_LINKS, VERIFICATION_HREF, businessHref } from "@/lib/account/accountLinks";
import { ProfileForm } from "./ProfileForm";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Alert } from "@/components/ui/Alert";
import { ErrorState } from "@/components/ui/ErrorState";
import { ChevronRight, MapPin, PackageCheck, PlusCircle, ShoppingBag, Banknote, Check } from "@/components/ui/icons";
import { buttonVariants, type BadgeTone } from "@/lib/ui/variants";

// Identity/account verification state comes from
// getVerificationStatus() (Supabase Auth + identity_verifications) —
// profiles.account_verification is a retained-but-dead legacy column and
// is never read here (see 20260928090000_identity_account_verification.sql).

// This page shows one specific signed-in user's own data — it must
// never be statically generated/cached, which could otherwise serve one
// user's account page to another. Every request re-runs requireUser().
export const dynamic = "force-dynamic";

const IDENTITY_LABELS = { not_submitted: "Not submitted", pending: "Pending review", verified: "Verified", rejected: "Rejected" } as const;
const IDENTITY_TONES: Record<keyof typeof IDENTITY_LABELS, BadgeTone> = { not_submitted: "neutral", pending: "warning", verified: "success", rejected: "danger" };

function LinkRow({ href, icon: Icon, label, hint }: { href: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-input px-1 py-2.5 transition-colors duration-150 ease-bambini hover:bg-brand-cream">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light-sage">
        <Icon className="h-4 w-4 text-bambini-forest" aria-hidden={true} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-small font-medium text-brand-ink">{label}</span>
        {hint && <span className="truncate text-caption text-brand-muted">{hint}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />
    </Link>
  );
}

export default async function AccountPage() {
  const user = await requireUser("/account");
  const [overview, verification] = await Promise.all([getAccountOverview(user.id), getVerificationStatus()]);

  if (!overview) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
        <h1 className="text-heading-page text-brand-ink">Your account</h1>
        <ErrorState title="We couldn't load your profile" description="Please refresh the page in a moment." />
      </div>
    );
  }

  const areaLabel = overview.savedArea ? [overview.savedArea.suburb, overview.savedArea.city].filter(Boolean).join(", ") : null;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex items-center gap-4">
        <Avatar name={overview.fullName} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-heading-page text-brand-ink">{overview.fullName}</h1>
          <p className="truncate text-body-small text-brand-muted">{user.email}</p>
          <p className="text-caption text-brand-muted">Member since {new Date(overview.memberSince).toLocaleDateString()}</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-heading-card text-brand-ink">Verification</h2>
            <Badge tone={IDENTITY_TONES[verification.identityStatus]}>
              {verification.identityStatus === "verified" && <Check className="h-3 w-3" aria-hidden="true" />}
              ID: {IDENTITY_LABELS[verification.identityStatus]}
            </Badge>
          </div>
          {verification.canTransact ? (
            <Alert tone="success">You&apos;re fully verified — you can buy and sell.</Alert>
          ) : (
            <Alert tone="info">Buying and selling on Bambini needs a fully verified account. Browsing never does.</Alert>
          )}
          <Link href={VERIFICATION_HREF} className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}>
            {verification.canTransact ? "View verification" : "Continue verification"}
          </Link>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-heading-card text-brand-ink">Buying</h2>
        <LinkRow href={BUYER_ORDERS_HREF} icon={ShoppingBag} label="Your orders" hint="Track purchases and payments" />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading-card text-brand-ink">Selling</h2>
        <LinkRow href={SELLER_LINKS.sell} icon={PackageCheck} label="Seller dashboard" hint="Your personal listings, orders and earnings" />
        <LinkRow href={SELLER_LINKS.newListing} icon={PlusCircle} label="Sell an item" />
        <LinkRow href={SELLER_LINKS.payouts} icon={Banknote} label="Payouts" />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading-card text-brand-ink">Businesses</h2>
        {overview.businesses.length === 0 ? (
          <p className="py-2 text-body-small text-brand-muted">You don&apos;t manage a business yet.</p>
        ) : (
          <ul>
            {overview.businesses.map((b) => (
              <li key={b.id}>
                <LinkRow href={businessHref(b.id)} icon={PackageCheck} label={b.businessName} hint={b.isOwner ? "You're the owner" : "You're on the team"} />
              </li>
            ))}
          </ul>
        )}
        <Link href={BUSINESSES_HREF} className="mt-1 inline-block text-body-small font-medium text-bambini-forest hover:underline">
          {overview.businesses.length === 0 ? "Start a business" : "Manage businesses"}
        </Link>
      </Card>

      <Card>
        <h2 className="mb-1 text-heading-card text-brand-ink">Saved location</h2>
        <LinkRow
          href={LOCATION_HREF}
          icon={MapPin}
          label={areaLabel ?? "No location saved yet"}
          hint={areaLabel ? "Only your suburb and city are ever shown to others" : "Used for Nearby and for collection on your listings"}
        />
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-card text-brand-ink">Profile</h2>
        <ProfileForm fullName={overview.fullName} phone={overview.phone} />
      </section>
    </div>
  );
}
