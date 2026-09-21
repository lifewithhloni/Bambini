import Link from "next/link";
import { requireUser } from "@/server/auth/requireUser";
import { getMyListings } from "@/server/listings/getMyListings";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { ListingCard } from "@/components/listings/ListingCard";

// Shows one specific user's own listings — must never be statically
// cached across visitors, same reasoning as /account.
export const dynamic = "force-dynamic";

export default async function SellDashboardPage() {
  const user = await requireUser("/sell");
  const listings = await getMyListings(user.id);

  const coverPaths = listings.map((l) => l.cover_image_path).filter((p): p is string => !!p);
  const imageUrls = await getSignedImageUrls(coverPaths);

  const draft = listings.filter((l) => l.status === "draft");
  const published = listings.filter((l) => l.status === "published");
  const sold = listings.filter((l) => l.status === "sold");
  const archived = listings.filter((l) => l.status === "archived");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-brand-ink">Your listings</h1>
        <Link
          href="/sell/new"
          className="rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage"
        >
          + New listing
        </Link>
      </div>

      <Link href="/sell/orders" className="text-sm font-medium text-brand-ink hover:underline">
        View orders →
      </Link>

      {listings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border px-4 py-10 text-center">
          <p className="text-brand-ink">You haven&apos;t listed anything yet.</p>
          <p className="mt-1 text-sm text-brand-muted">Sell something your kids have outgrown.</p>
          <Link
            href="/sell/new"
            className="mt-4 inline-block rounded-full bg-brand-sage-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-sage"
          >
            Create your first listing
          </Link>
        </div>
      ) : (
        <>
          {published.length > 0 && (
            <ListingSection title="Published" listings={published} imageUrls={imageUrls} />
          )}
          {draft.length > 0 && <ListingSection title="Drafts" listings={draft} imageUrls={imageUrls} />}
          {sold.length > 0 && <ListingSection title="Sold" listings={sold} imageUrls={imageUrls} />}
          {archived.length > 0 && <ListingSection title="Archived" listings={archived} imageUrls={imageUrls} />}
        </>
      )}
    </div>
  );
}

function ListingSection({
  title,
  listings,
  imageUrls,
}: {
  title: string;
  listings: Awaited<ReturnType<typeof getMyListings>>;
  imageUrls: Record<string, string>;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-brand-muted">{title}</h2>
      <div className="flex flex-col gap-2">
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            imageUrl={listing.cover_image_path ? (imageUrls[listing.cover_image_path] ?? null) : null}
          />
        ))}
      </div>
    </section>
  );
}
