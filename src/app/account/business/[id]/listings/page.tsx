import Link from "next/link";
import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessListings } from "@/server/listings/getBusinessListings";
import { getSignedImageUrls } from "@/server/listings/imageUrls";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { ListingCard } from "@/components/listings/ListingCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusCircle } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

export const dynamic = "force-dynamic";

/**
 * Cards link to the existing /sell/[id]/edit, whose own getListingForEdit()
 * already authorizes any member of the listing's business — no second edit
 * surface, and every status change still goes through changeListingStatus()
 * with its existing individual + business verification gates.
 */
export default async function BusinessListingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}/listings`);
  const listings = await getBusinessListings(id);
  const imageUrls = await getSignedImageUrls(listings.map((l) => l.cover_image_path).filter((p): p is string => !!p));

  const groups = [
    { title: "Published", items: listings.filter((l) => l.status === "published") },
    { title: "Drafts", items: listings.filter((l) => l.status === "draft") },
    { title: "Sold", items: listings.filter((l) => l.status === "sold") },
    { title: "Archived", items: listings.filter((l) => l.status === "archived") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-heading-card text-brand-ink">Listings</h2>
        <Link href="/sell/new" className={buttonVariants({ variant: "primary", size: "sm" })}>
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          New listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <EmptyState icon={PlusCircle} title="Your business has no listings yet" description="Choose your business under “Sell as” when you create a listing." />
      ) : (
        groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h3 className="text-body-small font-medium text-brand-muted">{g.title}</h3>
            {g.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} imageUrl={listing.cover_image_path ? (imageUrls[listing.cover_image_path] ?? null) : null} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
