import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getSavedItems, type SavedItem } from "@/server/favourites/getSavedItems";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { formatCentsAsRand } from "@/server/listings/price";
import { ProductCard } from "@/components/listings/ProductCard";
import { FavoriteButton } from "@/components/listings/FavoriteButton";
import { conditionLabel } from "@/components/listings/ConditionBadge";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heart, ImageOff, ChevronLeft } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

// One specific signed-in user's own private saved list — never statically cached.
export const dynamic = "force-dynamic";

/**
 * A saved item is the user's own intent/history; whether it can be bought
 * is read fresh from the product on every load (getSavedItems()). Available
 * items use the same ProductCard as every browse surface. A sold item stays
 * identifiable but clearly unavailable and non-clickable; an archived,
 * draft, or missing one is a details-free "no longer available" row. If
 * the read fails it throws, and this route's error.tsx shows the retry
 * state — never an empty list that would look like "nothing saved".
 */
export default async function SavedItemsPage() {
  const user = await requireUser("/account/saved");
  const items = await getSavedItems(user.id);

  const coverPaths = items.map((i) => i.listing?.cover_image_path).filter((p): p is string => !!p);
  const imageUrls = await getSignedImageUrls(coverPaths);

  const available = items.filter((i) => i.status === "available" && i.listing);
  const unavailable = items.filter((i) => i.status !== "available" || !i.listing);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/account" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to account
      </Link>

      <h1 className="text-heading-page text-brand-ink">Saved items</h1>

      {items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No saved items yet"
          description="Tap the heart on anything you like and it'll be waiting for you here."
          action={
            <Link href="/search" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Explore items
            </Link>
          }
        />
      ) : (
        <>
          {available.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {available.map((item) => (
                <ProductCard
                  key={item.productId}
                  listing={item.listing!}
                  imageUrl={item.listing!.cover_image_path ? (imageUrls[item.listing!.cover_image_path] ?? null) : null}
                  sellerName={item.listing!.sellerName ?? undefined}
                  favourite={{ signedIn: true, initiallySaved: true, refreshOnChange: true }}
                />
              ))}
            </div>
          )}

          {unavailable.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-heading-card text-brand-ink">No longer available</h2>
              <p className="text-body-small text-brand-muted">These can&apos;t be bought any more. You can keep them here for reference or remove them.</p>
              {unavailable.map((item) => (
                <UnavailableSavedItem key={item.productId} item={item} imageUrl={item.listing?.cover_image_path ? (imageUrls[item.listing.cover_image_path] ?? null) : null} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function UnavailableSavedItem({ item, imageUrl }: { item: SavedItem; imageUrl: string | null }) {
  const listing = item.listing;
  const title = listing?.title ?? "This listing";
  return (
    <Card elevation="subtle">
      <div className="flex gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-image bg-brand-cream opacity-70">
          {imageUrl ? (
            <Image src={imageUrl} alt="" fill sizes="64px" className="object-cover grayscale" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-brand-muted">
              <ImageOff className="h-4 w-4" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-body-small font-medium text-brand-muted">{listing ? listing.title : "This listing is no longer available"}</p>
            <Badge tone="neutral">{item.status === "sold" ? "Sold" : "No longer available"}</Badge>
          </div>
          {listing && (
            <p className="text-caption text-brand-muted">
              <span className="line-through">{formatCentsAsRand(listing.price_cents)}</span> · {conditionLabel(listing.condition)}
              {listing.sellerName ? ` · ${listing.sellerName}` : ""}
            </p>
          )}
          <FavoriteButton productId={item.productId} title={title} initiallySaved signedIn variant="remove" refreshOnChange />
        </div>
      </div>
    </Card>
  );
}
