import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getCategoryOptions } from "@/server/categories/getCategories";
import { getListingForEdit } from "@/server/listings/getListingForEdit";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { StatusBadge } from "@/components/listings/StatusBadge";
import { EditListingForm } from "./EditListingForm";
import { ImageManager } from "./ImageManager";
import { StatusActions } from "./StatusActions";

export const dynamic = "force-dynamic";

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photoError?: string }>;
}) {
  const { id } = await params;
  const { photoError } = await searchParams;
  const user = await requireUser(`/sell/${id}/edit`);

  const [listing, categories] = await Promise.all([getListingForEdit(id, user.id), getCategoryOptions()]);

  if (!listing) notFound();

  const imageUrls = await getSignedImageUrls(listing.images.map((img) => img.storage_path));
  const images = listing.images.map((img) => ({ ...img, url: imageUrls[img.storage_path] ?? null }));

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-brand-ink">Edit listing</h1>
        <StatusBadge status={listing.status} />
      </div>

      {photoError && (
        <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          Your listing was created, but one or more photos failed to upload. Try adding them again below.
        </p>
      )}

      {listing.status === "sold" ? (
        <p className="rounded-lg bg-brand-sage/20 px-3 py-2 text-sm text-brand-ink">
          This listing has been sold and can no longer be edited.
        </p>
      ) : (
        <>
          <StatusActions listingId={listing.id} status={listing.status} businessId={listing.business_id} />
          <ImageManager listingId={listing.id} images={images} />
          <EditListingForm listing={listing} categories={categories} />
        </>
      )}
    </div>
  );
}
