"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { updateLocation } from "./actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" loading={pending}>
      {pending ? "Saving…" : "Save location"}
    </Button>
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
      <Card elevation="subtle">
        <div className="flex flex-col gap-2">
          <p className="text-body-small font-medium text-brand-ink">Pinpoint</p>
          <p className="text-body-small text-brand-muted">
            Used to calculate distance for Nearby and to point buyers to roughly where they&apos;ll collect from — your exact location is never
            shown to anyone.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={captureLocation} loading={capturing} className="self-start">
            {capturing ? "Getting your location…" : coords ? "Update my current location" : "Use my current location"}
          </Button>
          {coords && <p className="text-caption text-brand-muted">Location captured ✓</p>}
          {captureError && <Alert tone="danger">{captureError}</Alert>}
          <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
          <input type="hidden" name="longitude" value={coords?.lng ?? ""} />
        </div>
      </Card>

      <div className="flex flex-col gap-1">
        <label htmlFor="suburb" className="text-body-small font-medium text-brand-ink">
          Suburb
        </label>
        <input id="suburb" name="suburb" type="text" required defaultValue={defaultValues?.suburb} className={inputVariants()} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="city" className="text-body-small font-medium text-brand-ink">
          City
        </label>
        <input id="city" name="city" type="text" required defaultValue={defaultValues?.city} className={inputVariants()} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="province" className="text-body-small font-medium text-brand-ink">
          Province <span className="text-brand-muted">(optional)</span>
        </label>
        <input id="province" name="province" type="text" defaultValue={defaultValues?.province} className={inputVariants()} />
      </div>

      {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}
      {state && "success" in state && (
        <Alert tone="success">
          Location saved.{" "}
          {returnTo && (
            <Link href={returnTo} className="font-medium underline">
              Back to checkout
            </Link>
          )}
        </Alert>
      )}

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
