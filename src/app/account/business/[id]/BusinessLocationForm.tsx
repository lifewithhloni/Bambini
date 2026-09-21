"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateBusinessLocation } from "@/server/business/updateBusinessLocation";

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

/** Mirrors src/app/account/location/LocationForm.tsx exactly, targeting the business's own location instead of the caller's own profile. */
export function BusinessLocationForm({ businessId, defaultValues }: { businessId: string; defaultValues?: { suburb?: string; city?: string } }) {
  const action = updateBusinessLocation.bind(null, businessId);
  const [state, formAction] = useActionState(action, null);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  function captureLocation() {
    if (!("geolocation" in navigator)) {
      setCaptureError("Your browser doesn't support location capture — enter the suburb and city instead.");
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
        setCaptureError("Couldn't get the location — check your browser's location permission and try again.");
        setCapturing(false);
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-brand-border bg-white p-4">
      <p className="text-sm font-medium text-brand-ink">Collection location</p>
      <button
        type="button"
        onClick={captureLocation}
        disabled={capturing}
        className="self-start rounded-full border border-brand-sage-dark px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-50"
      >
        {capturing ? "Getting location…" : coords ? "Update location" : "Use current location"}
      </button>
      {coords && <p className="text-xs text-brand-muted">Location captured ✓</p>}
      {captureError && (
        <p role="alert" className="text-xs text-brand-danger">
          {captureError}
        </p>
      )}
      <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
      <input type="hidden" name="longitude" value={coords?.lng ?? ""} />

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

      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && (
        <p role="status" className="rounded-lg bg-brand-sage/20 px-3 py-2 text-sm text-brand-ink">
          Location saved.
        </p>
      )}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
