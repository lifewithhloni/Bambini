import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { ProfileForm } from "./ProfileForm";

// Phase 5: profiles.account_verification is retained in the schema but
// is no longer read for authorization or display here — it's a legacy
// column nothing keeps in sync anymore (see
// 20260928090000_identity_account_verification.sql). Verification state
// now lives entirely on /account/verification, sourced live from
// Supabase Auth + the identity_verifications table.

// This page shows one specific signed-in user's own data — it must
// never be statically generated/cached, which could otherwise serve one
// user's account page to another. Every request re-runs requireUser().
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser("/account");

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, phone, role, created_at")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-8 px-4 py-12 sm:py-16">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Your account</h1>
        <p className="mt-1 text-sm text-brand-muted">{user.email}</p>
      </div>

      {error || !profile ? (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          We couldn&apos;t load your profile right now. Please refresh the page.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-brand-muted">Account type</dt>
            <dd className="text-brand-ink capitalize">{profile.role}</dd>
            <dt className="text-brand-muted">Member since</dt>
            <dd className="text-brand-ink">{new Date(profile.created_at).toLocaleDateString()}</dd>
          </dl>

          <ProfileForm fullName={profile.full_name} phone={profile.phone} />

          <Link
            href="/account/verification"
            className="rounded-full border border-brand-sage-dark px-4 py-2 text-center text-sm font-medium text-brand-ink hover:bg-brand-bg"
          >
            Verification
          </Link>

          <Link
            href="/account/location"
            className="rounded-full border border-brand-sage-dark px-4 py-2 text-center text-sm font-medium text-brand-ink hover:bg-brand-bg"
          >
            Set your location
          </Link>

          <Link
            href="/account/orders"
            className="rounded-full border border-brand-sage-dark px-4 py-2 text-center text-sm font-medium text-brand-ink hover:bg-brand-bg"
          >
            Your orders
          </Link>

          <Link
            href="/account/business"
            className="rounded-full border border-brand-sage-dark px-4 py-2 text-center text-sm font-medium text-brand-ink hover:bg-brand-bg"
          >
            Your businesses
          </Link>
        </>
      )}
    </div>
  );
}
