"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "@/lib/cart/useCart";
import { getCartListings, type CartData } from "@/server/cart/getCartListings";
import { CartItemList } from "@/components/cart/CartItemList";
import { CartSummary } from "@/components/cart/CartSummary";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { ShoppingBag } from "@/components/ui/icons";
import { buttonVariants } from "@/lib/ui/variants";

/**
 * A client-rendered page by necessity — the cart lives in the buyer's
 * own localStorage (see cartStorage.ts's own reasoning), which a Server
 * Component has no access to. `ids` comes from useCart(), which starts
 * as [] during SSR/first paint and corrects itself to the real stored
 * value right after mount (useSyncExternalStore's own mechanism, not a
 * manual hydration flag) — this effect simply re-fetches whenever `ids`
 * genuinely changes (useCart() only returns a new array reference when
 * the underlying content actually differs, so this doesn't loop). `data`
 * is only ever replaced, never cleared, between fetches, so removing an
 * item or a background refresh never flashes the whole page back to a
 * loading skeleton — only the very first load does that.
 */
export default function CartPage() {
  const { ids } = useCart();
  const [data, setData] = useState<CartData | null>(null);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getCartListings(ids)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ids, retryToken]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-heading-page text-brand-ink">Your cart</h1>

      {data === null && !error ? (
        <CartLoadingSkeleton />
      ) : error && data === null ? (
        <ErrorState description="We couldn't load your cart right now." onRetry={() => setRetryToken((t) => t + 1)} />
      ) : data && data.lines.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Add something you love to get started."
          action={
            <Link href="/search" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Start browsing
            </Link>
          }
        />
      ) : (
        data && (
          <>
            {data.canTransact === false && (
              <Alert tone="info">
                You&apos;ll need to verify your account before you can complete a purchase.{" "}
                <Link href="/account/verification" className="font-medium underline">
                  Verify now
                </Link>
              </Alert>
            )}
            <CartItemList lines={data.lines} />
            <CartSummary lines={data.lines} />
          </>
        )
      )}
    </div>
  );
}

function CartLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your cart">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
          <Skeleton className="h-20 w-20 rounded-image" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
