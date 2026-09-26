"use client";

import Link from "next/link";
import { ShoppingBag } from "@/components/ui/icons";
import { useCart } from "@/lib/cart/useCart";

/**
 * The cart icon + count shown in SiteHeader — visible to signed-out
 * visitors too, since Add to cart doesn't require authentication (only
 * proceeding to checkout does). The count is always however many
 * distinct listing ids are in localStorage right now; it is never a
 * server-computed number, and it counts unique listings, not units —
 * there is no quantity concept (see this phase's own report).
 */
export function CartCount() {
  const { count } = useCart();

  return (
    <Link href="/cart" className="relative flex items-center text-brand-ink hover:text-bambini-forest" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
      <ShoppingBag className="h-5 w-5" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-bambini-coral px-1 text-[10px] font-semibold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
