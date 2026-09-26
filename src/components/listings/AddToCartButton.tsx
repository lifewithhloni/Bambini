"use client";

import Link from "next/link";
import { Check, ShoppingBag } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";
import { useCart } from "@/lib/cart/useCart";

/**
 * The listing detail page's own purchase CTA now stops at cart intent
 * (see this phase's own report) — it never creates an order, reserves
 * anything, or calls PayFast. `disabledReason` is server-computed
 * (currently only "you own this listing") and is the one case Add to
 * cart itself refuses; everything else (verification, availability at
 * the moment of buying) is enforced later, server-side, when the buyer
 * actually proceeds from the cart.
 */
export function AddToCartButton({ productId, disabledReason }: { productId: string; disabledReason?: string | null }) {
  const { has, add, remove } = useCart();
  const inCart = has(productId);

  if (disabledReason) {
    return <p className="rounded-card bg-brand-cream px-4 py-3 text-center text-body-small text-brand-muted">{disabledReason}</p>;
  }

  if (inCart) {
    return (
      <div className="flex flex-col gap-2">
        <div className={buttonVariants({ variant: "secondary", size: "lg", fullWidth: true, className: "pointer-events-none" })}>
          <Check className="h-5 w-5" aria-hidden="true" />
          In your cart
        </div>
        <div className="flex gap-2">
          <Link href="/cart" className={buttonVariants({ variant: "primary", fullWidth: true })}>
            View cart
          </Link>
          <button type="button" onClick={() => remove(productId)} className={buttonVariants({ variant: "outline" })}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => add(productId)} className={buttonVariants({ variant: "primary", size: "lg", fullWidth: true })}>
      <ShoppingBag className="h-5 w-5" aria-hidden="true" />
      Add to cart
    </button>
  );
}
