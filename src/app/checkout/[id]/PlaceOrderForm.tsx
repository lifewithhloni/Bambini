"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { createOrder } from "@/server/orders/actions";
import { fetchDeliveryQuotes } from "@/server/delivery/actions";
import { formatCentsAsRand } from "@/server/listings/price";
import { calculateOrderTotal } from "@/lib/orders/orderTotal";
import { isQuoteExpired } from "@/lib/delivery/quoteExpiry";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Truck, PackageCheck, CreditCard, Banknote, Clock } from "@/components/ui/icons";
import type { BuyerDeliveryQuote } from "@/server/delivery/quoteService";

function PlaceOrderButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} disabled={disabled}>
      {pending ? "Placing order…" : label}
    </Button>
  );
}

function serviceLevelLabel(level: BuyerDeliveryQuote["serviceLevel"]): string {
  if (level === "cheapest") return "Cheapest";
  if (level === "express") return "Express";
  return "Standard";
}

function etaLabel(quote: BuyerDeliveryQuote): string {
  if (quote.etaMinMinutes == null || quote.etaMaxMinutes == null) return "ETA unavailable";
  const toHours = (min: number) => Math.round(min / 60);
  const minH = toHours(quote.etaMinMinutes);
  const maxH = toHours(quote.etaMaxMinutes);
  if (minH === maxH) return `~${minH}h`;
  return `${minH}–${maxH}h`;
}

/**
 * Phase 7A: replaces the old static delivery radio with a real
 * quote-fetching flow (§7 of the phase brief). Quotes are fetched only
 * the moment the buyer actually selects "Delivery" — never on page
 * load, never hardcoded — and the buyer must pick exactly one before
 * the order can be submitted; its id (never a price) travels with the
 * form as `deliveryQuoteId`. create_order() re-validates that id
 * server-side regardless of anything shown here.
 *
 * Phase 12B adds: a live order-total summary (product + delivery fee,
 * computed here only from numbers the server already produced — see
 * calculateOrderTotal()'s own comment for why this isn't "calculating
 * delivery prices in the browser"), and a proactive client-side quote
 * expiry check so a stale quote is caught before submit rather than as
 * a late server rejection — create_order() remains the actual
 * expiry-enforcement boundary regardless (see
 * 20260930090000_delivery_quoting_booking.sql).
 */
export function PlaceOrderForm({
  productId,
  productPriceCents,
  collectionAvailable,
  deliveryAvailable,
  deliveryDisabledReason,
  cashOffered,
}: {
  productId: string;
  productPriceCents: number;
  collectionAvailable: boolean;
  deliveryAvailable: boolean;
  /** Non-null disables the delivery option even when the listing supports it — e.g. no saved delivery location yet. */
  deliveryDisabledReason: string | null;
  /** Display only — create_order() independently re-validates cash eligibility, the global switch, and collection-only server-side regardless of this flag (see src/server/orders/getCheckoutListing.ts). */
  cashOffered: boolean;
}) {
  const action = createOrder.bind(null, productId);
  const [state, formAction] = useActionState(action, null);

  const deliverySelectable = deliveryAvailable && !deliveryDisabledReason;
  const defaultFulfilment = collectionAvailable ? "collection" : deliverySelectable ? "delivery" : "";
  const [fulfilment, setFulfilment] = useState(defaultFulfilment);
  const [paymentMethod, setPaymentMethod] = useState<"online" | "cash">("online");

  const [quotesState, setQuotesState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; quotes: BuyerDeliveryQuote[] }
  >({ status: "idle" });
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [isFetchingQuotes, startFetchingQuotes] = useTransition();

  // Ticks every 15s only while a fetched delivery quote is actually on
  // screen — this is purely what re-renders the "expired" check below
  // against the wall clock; it never fetches or mutates anything itself.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (fulfilment !== "delivery" || quotesState.status !== "ready") return;
    const interval = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, [fulfilment, quotesState.status]);

  function loadQuotes() {
    setQuotesState({ status: "loading" });
    setSelectedQuoteId(null);
    startFetchingQuotes(async () => {
      const result = await fetchDeliveryQuotes(productId);
      if (!result.ok) {
        setQuotesState({ status: "error", error: result.error });
        return;
      }
      setQuotesState({ status: "ready", quotes: result.quotes });
      // Cheapest-first (already sorted server-side) — pre-select the
      // first option so a buyer who agrees with the default doesn't
      // have to click twice, but every option remains changeable.
      setSelectedQuoteId(result.quotes[0]?.id ?? null);
      setNowMs(Date.now());
    });
  }

  function selectFulfilment(next: "collection" | "delivery") {
    setFulfilment(next);
    if (next === "delivery" && quotesState.status === "idle") {
      loadQuotes();
    }
    // Cash only ever applies to collection — switching to delivery while
    // "cash" was selected would otherwise silently submit a combination
    // create_order() rejects; the hidden field below forces "online" for
    // delivery regardless, but resetting the visible state too keeps the
    // UI honest if the buyer switches back to collection afterward.
    if (next === "delivery") {
      setPaymentMethod("online");
    }
  }

  const selectedQuote = quotesState.status === "ready" ? (quotesState.quotes.find((q) => q.id === selectedQuoteId) ?? null) : null;
  const quoteExpired = selectedQuote !== null && isQuoteExpired(selectedQuote.expiresAt, nowMs);

  // Cash only ever makes sense alongside collection — hiding it the
  // moment delivery is selected is a UX nicety only, not the security
  // boundary (create_order() rejects cash+delivery regardless).
  const showCashOption = cashOffered && fulfilment === "collection";
  const showCashUnavailableNote = !cashOffered && collectionAvailable && fulfilment === "collection";

  const deliveryReady = fulfilment === "delivery" && quotesState.status === "ready" && selectedQuoteId !== null && !quoteExpired;
  const canSubmit = fulfilment === "collection" || deliveryReady;

  const orderTotal = calculateOrderTotal({
    productPriceCents,
    fulfilment: fulfilment === "collection" || fulfilment === "delivery" ? fulfilment : "",
    selectedDeliveryFeeCents: fulfilment === "delivery" && selectedQuote && !quoteExpired ? selectedQuote.priceCents : null,
  });

  // "Continue to payment" is honest about what actually happens next —
  // the order is created pending_payment and the buyer is taken to
  // /orders/[id]/pay, which is where PayFast is actually triggered
  // (Phase 12C, not this phase — see PayButton.tsx). "Place collection
  // order" is used only for the one path that doesn't lead there: cash
  // on collection, where the order is immediately awaiting the seller's
  // acceptance instead. Never "Pay now" — no payment has happened yet.
  const ctaLabel = fulfilment === "collection" && paymentMethod === "cash" ? "Place collection order" : "Continue to payment";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-heading-card text-brand-ink">How will you get it?</legend>
        <div className="flex flex-col gap-2">
          {collectionAvailable && (
            <label
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-card border px-3.5 py-3 text-body-small transition-colors duration-150 ease-bambini ${
                fulfilment === "collection" ? "border-bambini-forest bg-brand-light-sage" : "border-brand-border bg-brand-surface"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="fulfilmentType"
                  value="collection"
                  checked={fulfilment === "collection"}
                  onChange={() => selectFulfilment("collection")}
                  className="h-4 w-4 text-brand-sage-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-bambini-forest"
                />
                <PackageCheck className="h-4 w-4 text-brand-sage-dark" aria-hidden="true" />
                <span className="font-medium text-brand-ink">Free collection</span>
              </span>
              <span className="font-medium text-brand-sage-dark">R 0.00</span>
            </label>
          )}
          {deliveryAvailable && (
            <label
              className={`flex items-center gap-2.5 rounded-card border px-3.5 py-3 text-body-small transition-colors duration-150 ease-bambini ${
                !deliverySelectable
                  ? "cursor-not-allowed border-brand-border bg-brand-surface text-brand-muted"
                  : fulfilment === "delivery"
                    ? "cursor-pointer border-bambini-forest bg-brand-light-sage"
                    : "cursor-pointer border-brand-border bg-brand-surface"
              }`}
            >
              <input
                type="radio"
                name="fulfilmentType"
                value="delivery"
                disabled={!deliverySelectable}
                checked={fulfilment === "delivery"}
                onChange={() => selectFulfilment("delivery")}
                className="h-4 w-4 text-brand-sage-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-bambini-forest"
              />
              <Truck className={`h-4 w-4 ${deliverySelectable ? "text-brand-sage-dark" : "text-brand-muted"}`} aria-hidden="true" />
              <span className={deliverySelectable ? "font-medium text-brand-ink" : "font-medium"}>Delivery</span>
            </label>
          )}
        </div>
        {deliveryAvailable && deliveryDisabledReason && (
          <Alert tone="info">
            {deliveryDisabledReason}{" "}
            <Link href={`/account/location?next=/checkout/${productId}`} className="font-medium underline">
              Set your location
            </Link>
          </Alert>
        )}
      </fieldset>

      {fulfilment === "delivery" && (
        <Card elevation="subtle">
          <fieldset className="flex flex-col gap-2">
            <legend className="px-0 text-body-small font-medium text-brand-ink">Delivery option</legend>

            {quotesState.status === "loading" && (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label="Fetching delivery options">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {quotesState.status === "error" && (
              <div className="flex flex-col gap-2">
                <Alert tone="danger">{quotesState.error}</Alert>
                <Button type="button" variant="outline" size="sm" onClick={loadQuotes} disabled={isFetchingQuotes} className="self-start">
                  Try again
                </Button>
              </div>
            )}

            {quotesState.status === "ready" && quotesState.quotes.length === 0 && (
              <p className="text-body-small text-brand-muted">No delivery options are available for this listing right now.</p>
            )}

            {quotesState.status === "ready" &&
              quotesState.quotes.map((quote) => {
                const expired = isQuoteExpired(quote.expiresAt, nowMs);
                return (
                  <label
                    key={quote.id}
                    className={`flex items-center justify-between gap-2 rounded-input border px-3.5 py-2.5 text-body-small text-brand-ink transition-colors duration-150 ease-bambini ${
                      selectedQuoteId === quote.id ? "border-bambini-forest bg-brand-light-sage" : "border-brand-border"
                    } ${expired ? "opacity-60" : "cursor-pointer"}`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="_deliveryQuoteChoice"
                        checked={selectedQuoteId === quote.id}
                        disabled={expired}
                        onChange={() => setSelectedQuoteId(quote.id)}
                        className="h-4 w-4 text-brand-sage-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-bambini-forest"
                      />
                      <span className="flex flex-col">
                        <span className="font-medium">{serviceLevelLabel(quote.serviceLevel)}</span>
                        <span className="text-caption text-brand-muted">
                          {quote.providerName} · {etaLabel(quote)}
                        </span>
                      </span>
                    </span>
                    <span className="font-medium">{formatCentsAsRand(quote.priceCents)}</span>
                  </label>
                );
              })}

            {quoteExpired && (
              <Alert tone="danger">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  This delivery option has expired. Refresh to see current pricing.
                </span>
              </Alert>
            )}

            {quotesState.status === "ready" && quotesState.quotes.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={loadQuotes} disabled={isFetchingQuotes} className="self-start">
                Refresh delivery options
              </Button>
            )}

            {/* The only delivery-related value the form actually submits — a
                quote id, never a price. create_order() looks this row up
                and derives delivery_fee_cents/total_cents from it itself. */}
            <input type="hidden" name="deliveryQuoteId" value={quoteExpired ? "" : (selectedQuoteId ?? "")} />
          </fieldset>
        </Card>
      )}

      {fulfilment === "collection" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-small font-medium text-brand-ink">Payment</legend>
          <label className="flex items-center gap-2.5 rounded-card border border-brand-border bg-brand-surface px-3.5 py-3 text-body-small text-brand-ink">
            <input
              type="radio"
              name="paymentMethod"
              value="online"
              checked={paymentMethod === "online"}
              onChange={() => setPaymentMethod("online")}
              className="h-4 w-4 text-brand-sage-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-bambini-forest"
            />
            <CreditCard className="h-4 w-4 text-brand-sage-dark" aria-hidden="true" />
            Pay online
          </label>
          {showCashOption && (
            <label className="flex items-center gap-2.5 rounded-card border border-brand-border bg-brand-surface px-3.5 py-3 text-body-small text-brand-ink">
              <input
                type="radio"
                name="paymentMethod"
                value="cash"
                checked={paymentMethod === "cash"}
                onChange={() => setPaymentMethod("cash")}
                className="h-4 w-4 text-brand-sage-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-bambini-forest"
              />
              <Banknote className="h-4 w-4 text-brand-sage-dark" aria-hidden="true" />
              Cash on collection
            </label>
          )}
          {showCashUnavailableNote && <p className="text-caption text-brand-muted">Cash on collection isn&apos;t available for this order — you&apos;ll pay online.</p>}
        </fieldset>
      )}

      {fulfilment === "delivery" && (
        // Delivery is always paid online (create_order() rejects
        // cash+delivery) — a hidden field keeps the form payload
        // consistent without showing a payment-method choice that would
        // only ever have one legitimate option.
        <input type="hidden" name="paymentMethod" value="online" />
      )}

      <Card elevation="subtle">
        <div className="flex flex-col gap-1.5 text-body-small">
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">Product</span>
            <span className="text-brand-ink">{formatCentsAsRand(productPriceCents)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-brand-muted">{fulfilment === "collection" ? "Collection" : "Delivery"}</span>
            <span className={fulfilment === "collection" ? "font-medium text-brand-sage-dark" : "text-brand-ink"}>
              {orderTotal.deliveryFeeCents === null ? "—" : orderTotal.deliveryFeeCents === 0 ? "FREE" : formatCentsAsRand(orderTotal.deliveryFeeCents)}
            </span>
          </div>
          <div className="my-1 h-px bg-brand-border" />
          <div className="flex items-center justify-between text-heading-card">
            <span className="text-brand-ink">Total</span>
            <span className="text-brand-ink">{orderTotal.totalCents === null ? "—" : formatCentsAsRand(orderTotal.totalCents)}</span>
          </div>
        </div>
      </Card>

      {state && "error" in state && (
        <Alert tone="danger">
          <div className="flex flex-col gap-1">
            <span>{state.error}</span>
            {state.verificationRequired && (
              <Link href="/account/verification" className="font-medium underline">
                Verify your account
              </Link>
            )}
          </div>
        </Alert>
      )}

      <PlaceOrderButton label={ctaLabel} disabled={!canSubmit} />
    </form>
  );
}
