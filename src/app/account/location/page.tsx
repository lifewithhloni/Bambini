import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { LocationForm } from "./LocationForm";
import { Alert } from "@/components/ui/Alert";
import { ChevronLeft, MapPin } from "@/components/ui/icons";

// Shows one specific signed-in user's own saved location — never
// statically generated/cached (same reasoning as /account itself).
export const dynamic = "force-dynamic";

export default async function AccountLocationPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await requireUser("/account/location");

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("location_id").eq("id", user.id).maybeSingle();

  let existing:
    | { latitude: number; longitude: number; suburb: string | null; city: string | null; province: string | null }
    | null = null;

  if (profile?.location_id) {
    const { data: location } = await supabase
      .from("locations")
      .select("latitude, longitude, suburb, city, province")
      .eq("id", profile.location_id)
      .maybeSingle();
    existing = location ?? null;
  }

  const areaLabel = existing ? [existing.suburb, existing.city].filter(Boolean).join(", ") : null;
  // Only ever an internal checkout path this same page's own
  // "Set your location" link put there (see
  // src/app/checkout/[id]/page.tsx) — never followed anywhere
  // else, so a stray/crafted `next` value can't be turned into an
  // open redirect.
  const returnTo = next && /^\/checkout\/[^/]+$/.test(next) ? next : undefined;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <Link href="/account" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to account
      </Link>

      <div>
        <h1 className="text-heading-page text-brand-ink">Your location</h1>
        <p className="mt-1 text-body-small text-brand-muted">
          Set this once — it&apos;s used for collection on your listings and for Nearby browsing.
        </p>
      </div>

      {areaLabel ? (
        <Alert tone="info">
          <span className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            Currently saved: {areaLabel}
          </span>
        </Alert>
      ) : (
        <Alert tone="info">You haven&apos;t saved a location yet.</Alert>
      )}

      <LocationForm
        defaultValues={
          existing
            ? {
                latitude: existing.latitude,
                longitude: existing.longitude,
                suburb: existing.suburb ?? undefined,
                city: existing.city ?? undefined,
                province: existing.province ?? undefined,
              }
            : undefined
        }
        returnTo={returnTo}
      />
    </div>
  );
}
