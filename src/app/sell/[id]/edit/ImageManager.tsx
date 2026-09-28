"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { addListingImages, removeListingImage } from "@/server/listings/actions";
import { PhotoPicker } from "@/components/listings/PhotoPicker";
import { MAX_IMAGES_PER_LISTING } from "@/server/listings/imageValidation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" loading={pending}>
      {pending ? "Uploading…" : "Add photos"}
    </Button>
  );
}

export function ImageManager({
  listingId,
  images,
}: {
  listingId: string;
  images: { id: string; storage_path: string; url: string | null }[];
}) {
  const addAction = addListingImages.bind(null, listingId);
  const [state, formAction] = useActionState(addAction, null);
  const [isPending, startTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const router = useRouter();

  function onRemove(imageId: string) {
    setRemoveError(null);
    startTransition(async () => {
      const result = await removeListingImage(imageId, listingId);
      if ("error" in result) {
        setRemoveError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-body-small font-medium text-brand-ink">Photos</h2>

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img) => (
            <div key={img.id} className="relative aspect-square overflow-hidden rounded-image bg-brand-cream">
              {img.url && <Image src={img.url} alt="" fill className="object-cover" />}
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRemove(img.id)}
                aria-label="Remove photo"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {removeError && <Alert tone="danger">{removeError}</Alert>}

      {images.length < MAX_IMAGES_PER_LISTING && (
        <form action={formAction} className="flex flex-col gap-2">
          <PhotoPicker maxFiles={MAX_IMAGES_PER_LISTING - images.length} />
          {state?.error && <Alert tone="danger">{state.error}</Alert>}
          <div>
            <AddButton />
          </div>
        </form>
      )}
    </div>
  );
}
