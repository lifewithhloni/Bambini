import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutListing } from "@/server/orders/getCheckoutListing";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";
import { PlaceOrderForm } from "./PlaceOrderForm";

// A checkout review depends on the live product price/availability and
// the signed-in buyer's own saved location — never statically cached.
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/checkout/${id}`);

  const listing = await getCheckoutListing(id);
  if (!listing) notFound();

  const isOwnListing = listing.sellerType === "parent" && listing.sellerProfileId === user.id;

  const imageUrls = listing.coverImagePath ? await getSignedImageUrls([listing.coverImagePath]) : {};
  const imageUrl = listing.coverImagePath ? (imageUrls[listing.coverImagePath] ?? null) : null;

  let deliveryDisabledReason: string | null = null;
  if (listing.deliveryAvailable) {
    const supabase = await createClient();
    const { data: profile } = await supabase.from("profiles").select("location_id").eq("id", user.id).maybeSingle();
    if (!profile?.location_id) {
      deliveryDisabledReason = "Set your delivery location first.";
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-xl font-semibold text-brand-ink">Review your order</h1>

      {isOwnListing ? (
        <p className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          You can&apos;t buy your own listing.
        </p>
      ) : (
        <>
          <div className="flex gap-3 rounded-lg border border-brand-border bg-white p-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-brand-bg">
              {imageUrl ? (
                <Image src={imageUrl} alt="" width={80} height={80} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-brand-muted">No photo</div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate font-medium text-brand-ink">{listing.title}</p>
              {listing.sellerName && <p className="text-xs text-brand-muted">Sold by {listing.sellerName}</p>}
              <p className="text-sm font-semibold text-brand-ink">{formatCentsAsRand(listing.priceCents)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-brand-border bg-white p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-brand-muted">Subtotal</span>
              <span className="text-brand-ink">{formatCentsAsRand(listing.priceCents)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold">
              <span className="text-brand-ink">Total</span>
              <span className="text-brand-ink">{formatCentsAsRand(listing.priceCents)}</span>
            </div>
          </div>

          {deliveryDisabledReason && (
            <p className="text-xs text-brand-muted">
              {deliveryDisabledReason}{" "}
              <Link href="/account/location" className="font-medium text-brand-ink hover:underline">
                Set your location
              </Link>
            </p>
          )}

          <PlaceOrderForm
            productId={listing.id}
            collectionAvailable={listing.collectionAvailable}
            deliveryAvailable={listing.deliveryAvailable}
            deliveryDisabledReason={deliveryDisabledReason}
          />
        </>
      )}
    </div>
  );
}
