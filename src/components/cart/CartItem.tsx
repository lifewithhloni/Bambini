import Image from "next/image";
import Link from "next/link";
import { formatCentsAsRand } from "@/server/listings/price";
import { conditionLabel } from "@/components/listings/ConditionBadge";
import { Badge } from "@/components/ui/Badge";
import { RemoveFromCartButton } from "./RemoveFromCartButton";
import { ImageOff } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";
import type { CartLine } from "@/server/cart/getCartListings";

const STALE_MESSAGES: Record<string, string> = {
  sold: "This item has been sold.",
  unavailable: "This listing is no longer available.",
  deleted: "This listing no longer exists.",
  own_listing: "This is your own listing.",
};

/**
 * One cart line — the price shown is always whatever getCartListings()
 * just re-fetched (never a value cached at add-to-cart time), and the
 * "Buy now" link only appears for status = "available"; every other
 * status gets its own clear, specific message instead (never a generic
 * "unavailable" for all four different reasons).
 */
export function CartItem({ line }: { line: CartLine }) {
  const isAvailable = line.status === "available";

  return (
    <li className="flex gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-image bg-brand-cream">
        {line.imageUrl ? (
          <Image src={line.imageUrl} alt="" fill sizes="80px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-brand-muted">
            <ImageOff className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-body-small font-medium text-brand-ink">{line.title ?? "Listing no longer available"}</p>
          <RemoveFromCartButton id={line.id} title={line.title} />
        </div>

        {line.sellerName && isAvailable && <p className="truncate text-caption text-brand-muted">{line.sellerName}</p>}
        {line.condition && isAvailable && (
          <span className="w-fit">
            <Badge tone="info">{conditionLabel(line.condition)}</Badge>
          </span>
        )}

        {isAvailable ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-price text-brand-ink">{formatCentsAsRand(line.priceCents ?? 0)}</p>
            <Link href={`/checkout/${line.id}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
              Buy now
            </Link>
          </div>
        ) : (
          <div className="mt-1 flex flex-col gap-1">
            {line.priceCents !== null && (
              <p className="text-body-small text-brand-muted line-through">{formatCentsAsRand(line.priceCents)}</p>
            )}
            <p role="status" className={`text-body-small font-medium ${line.status === "own_listing" ? "text-brand-muted" : "text-brand-danger"}`}>
              {STALE_MESSAGES[line.status] ?? "This listing is no longer available."}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
