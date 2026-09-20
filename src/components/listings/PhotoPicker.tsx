"use client";

import { useEffect, useState } from "react";

const ACCEPTED = "image/png,image/jpeg,image/webp";

/**
 * A plain, uncontrolled <input type="file" name="photos" multiple> is
 * still what actually submits with the form (server-side validation in
 * src/server/listings/imageValidation.ts is authoritative regardless) —
 * this just adds thumbnail previews and a running count for UX.
 */
export function PhotoPicker({ maxFiles }: { maxFiles: number }) {
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of previews) URL.revokeObjectURL(url);
    };
  }, [previews]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    for (const url of previews) URL.revokeObjectURL(url);
    const files = Array.from(e.target.files ?? []);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="photos" className="text-sm font-medium text-brand-ink">
        Photos <span className="text-brand-muted">(up to {maxFiles})</span>
      </label>
      <input
        id="photos"
        name="photos"
        type="file"
        accept={ACCEPTED}
        multiple
        onChange={onChange}
        className="text-sm text-brand-ink file:mr-3 file:rounded-full file:border-0 file:bg-brand-sage-dark file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-sage"
      />
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, next/image can't optimize it
            <img key={i} src={src} alt="" className="h-16 w-16 rounded-md object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
