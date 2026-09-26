"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { updateLocation } from "./actions";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save location"}
    </button>
  );
}

export function LocationForm({
  defaultValues,
  returnTo,
}: {
  defaultValues?: {
    latitude?: number;
    longitude?: number;
    suburb?: string;
    city?: string;
    province?: string;
  };
  /** When set (arrived here from checkout needing a delivery location), offer a direct way back after a successful save. */
  returnTo?: string;
}) {
  const [state, formAction] = useActionState(updateLocation, null);

  // Coordinates are never captured until this button is clicked — never
  // on page load, never from IP address (see DECISIONS.md). Clicking it
  // triggers the browser's own permission prompt; the coordinates then
  // only ever leave the browser as part of this same form's own submit,
  // to this same account's own location record.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    defaultValues?.latitude !== undefined && defaultValues?.longitude !== undefined
      ? { lat: defaultValues.latitude, lng: defaultValues.longitude }
      : null,
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  function captureLocation() {
    if (!("geolocation" in navigator)) {
      setCaptureError("Your browser doesn't support location capture — enter your suburb and city instead.");
      return;
    }
    setCapturing(true);
    setCaptureError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setCapturing(false);
      },
      () => {
        setCaptureError("Couldn't get your location — check your browser's location permission and try again.");
        setCapturing(false);
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
        <p className="text-sm font-medium text-brand-ink">Pinpoint</p>
        <p className="text-sm text-brand-muted">
          Used to calculate distance for Nearby and to point buyers to roughly where they&apos;ll collect from —
          your exact location is never shown to anyone.
        </p>
        <button
          type="button"
          onClick={captureLocation}
          disabled={capturing}
          className="self-start rounded-full border border-brand-sage-dark px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-50"
        >
          {capturing ? "Getting your location…" : coords ? "Update my current location" : "Use my current location"}
        </button>
        {coords && <p className="text-xs text-brand-muted">Location captured ✓</p>}
        {captureError && (
          <p role="alert" className="text-xs text-brand-danger">
            {captureError}
          </p>
        )}
        <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
        <input type="hidden" name="longitude" value={coords?.lng ?? ""} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="suburb" className="text-sm font-medium text-brand-ink">
          Suburb
        </label>
        <input id="suburb" name="suburb" type="text" required defaultValue={defaultValues?.suburb} className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="city" className="text-sm font-medium text-brand-ink">
          City
        </label>
        <input id="city" name="city" type="text" required defaultValue={defaultValues?.city} className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="province" className="text-sm font-medium text-brand-ink">
          Province <span className="text-brand-muted">(optional)</span>
        </label>
        <input id="province" name="province" type="text" defaultValue={defaultValues?.province} className={inputClass} />
      </div>

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && (
        <p role="status" className="rounded-lg bg-brand-sage/20 px-3 py-2 text-sm text-brand-ink">
          Location saved.{" "}
          {returnTo && (
            <Link href={returnTo} className="font-medium underline">
              Back to checkout
            </Link>
          )}
        </p>
      )}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
