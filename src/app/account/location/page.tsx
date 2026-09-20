import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { LocationForm } from "./LocationForm";

// Shows one specific signed-in user's own saved location — never
// statically generated/cached (same reasoning as /account itself).
export const dynamic = "force-dynamic";

export default async function AccountLocationPage() {
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

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12 sm:py-16">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Your location</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Set this once — it&apos;s used for collection on your listings and for Nearby browsing.
        </p>
      </div>

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
      />
    </div>
  );
}
