import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutListing } from "@/server/orders/getCheckoutListing";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";
import { ConditionBadge } from "@/components/listings/ConditionBadge";
import { SellerCard } from "@/components/listings/SellerCard";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImageOff, ChevronLeft, ShoppingBag } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";
import { PlaceOrderForm } from "./PlaceOrderForm";

// A checkout review depends on the live product price/availability and
// the signed-in buyer's own saved location — never statically cached.
export const dynamic = "force-dynamic";

function BackLink() {
  return (
    <Link href="/cart" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      Back to cart
    </Link>
  );
}

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/checkout/${id}`);

  const listing = await getCheckoutListing(id);

  // getCheckoutListing() returns null for anything not currently
  // status = 'published' — sold, unpublished, archived, or a genuinely
  // nonexistent id all look identical here (no existence leak), same as
  // getPublicListing()'s own contract. A blunt framework 404 would leave
  // the buyer without any explanation or way back into the flow they
  // were in (Phase 12A cart -> "Buy now"), so this gets its own warm,
  // routed empty state instead (§4 of the phase brief).
  if (!listing) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
        <BackLink />
        <EmptyState
          icon={ShoppingBag}
          title="This listing isn't available anymore"
          description="It may have sold, been taken down, or is no longer published since you added it to your cart."
          action={
            <Link href="/cart" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Back to cart
            </Link>
          }
        />
      </div>
    );
  }

  // getCheckoutListing() deliberately doesn't compute ownership itself
  // (its own "public-safe" contract mirrors getPublicListing()) — this
  // checks both parent ownership AND business ownership/membership (owner
  // or staff), the same two-source check already established in
  // /sell/orders/[id]/page.tsx's viewerIsOrderSeller() and reused for
  // /listings/[id] and the cart. create_order() re-derives and
  // re-checks both independently regardless (see
  // 20260930090000_delivery_quoting_booking.sql) — this only decides
  // whether this page renders a buy flow at all.
  let isOwnListing = listing.sellerType === "parent" && listing.sellerProfileId === user.id;
  if (!isOwnListing && listing.sellerType === "business" && listing.businessId) {
    const supabase = await createClient();
    const [{ data: owned }, { data: member }] = await Promise.all([
      supabase.from("businesses").select("id").eq("id", listing.businessId).eq("owner_profile_id", user.id).maybeSingle(),
      supabase.from("business_members").select("business_id").eq("business_id", listing.businessId).eq("profile_id", user.id).maybeSingle(),
    ]);
    isOwnListing = !!owned || !!member;
  }

  if (isOwnListing) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
        <BackLink />
        <EmptyState
          icon={ShoppingBag}
          title="You can't buy your own listing"
          description="This listing belongs to you — browse other listings to find something to buy."
          action={
            <Link href="/search" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Browse listings
            </Link>
          }
        />
      </div>
    );
  }

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
      <BackLink />
      <h1 className="text-heading-page text-brand-ink">Review your order</h1>

      <Card>
        <div className="flex gap-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-image bg-brand-cream">
            {imageUrl ? (
              <Image src={imageUrl} alt="" fill sizes="80px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-brand-muted">
                <ImageOff className="h-5 w-5" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-heading-card text-brand-ink">{listing.title}</p>
              <ConditionBadge condition={listing.condition} />
            </div>
            <p className="text-price text-brand-ink">{formatCentsAsRand(listing.priceCents)}</p>
            {listing.location?.suburb && (
              <p className="text-caption text-brand-muted">{[listing.location.suburb, listing.location.city].filter(Boolean).join(", ")}</p>
            )}
          </div>
        </div>
      </Card>

      {listing.sellerName && (
        <SellerCard name={listing.sellerName} avatarUrl={listing.sellerAvatarUrl} isVerified={listing.sellerIsVerified} subtitle="Seller" />
      )}

      <PlaceOrderForm
        productId={listing.id}
        productPriceCents={listing.priceCents}
        collectionAvailable={listing.collectionAvailable}
        deliveryAvailable={listing.deliveryAvailable}
        deliveryDisabledReason={deliveryDisabledReason}
        cashOffered={listing.cashOffered}
      />
    </div>
  );
}
