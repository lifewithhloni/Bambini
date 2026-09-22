"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { createOrder } from "@/server/orders/actions";
import { fetchDeliveryQuotes } from "@/server/delivery/actions";
import { formatCentsAsRand } from "@/server/listings/price";
import type { BuyerDeliveryQuote } from "@/server/delivery/quoteService";

function PlaceOrderButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-3 text-sm font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Placing order…" : "Place order"}
    </button>
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
 */
export function PlaceOrderForm({
  productId,
  collectionAvailable,
  deliveryAvailable,
  deliveryDisabledReason,
  cashOffered,
}: {
  productId: string;
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

  const [quotesState, setQuotesState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; quotes: BuyerDeliveryQuote[] }
  >({ status: "idle" });
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [isFetchingQuotes, startFetchingQuotes] = useTransition();

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
    });
  }

  function selectFulfilment(next: "collection" | "delivery") {
    setFulfilment(next);
    if (next === "delivery" && quotesState.status === "idle") {
      loadQuotes();
    }
  }

  // Cash only ever makes sense alongside collection — hiding it the
  // moment delivery is selected is a UX nicety only, not the security
  // boundary (create_order() rejects cash+delivery regardless).
  const showCashOption = cashOffered && fulfilment === "collection";

  const deliveryReady = fulfilment === "delivery" && quotesState.status === "ready" && selectedQuoteId !== null;
  const canSubmit = fulfilment === "collection" || deliveryReady;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-brand-ink">Fulfilment</legend>
        {collectionAvailable && (
          <label className="flex items-center justify-between gap-2 text-sm text-brand-ink">
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="fulfilmentType"
                value="collection"
                checked={fulfilment === "collection"}
                onChange={() => selectFulfilment("collection")}
                className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
              />
              Free collection
            </span>
            <span className="text-brand-muted">R 0.00</span>
          </label>
        )}
        {deliveryAvailable && (
          <label className={`flex items-center gap-2 text-sm ${deliverySelectable ? "text-brand-ink" : "text-brand-muted"}`}>
            <input
              type="radio"
              name="fulfilmentType"
              value="delivery"
              disabled={!deliverySelectable}
              checked={fulfilment === "delivery"}
              onChange={() => selectFulfilment("delivery")}
              className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
            />
            Delivery
          </label>
        )}
        {deliveryAvailable && deliveryDisabledReason && (
          <p className="text-xs text-brand-muted">{deliveryDisabledReason}</p>
        )}
      </fieldset>

      {fulfilment === "delivery" && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-3">
          <legend className="px-1 text-sm font-medium text-brand-ink">Delivery option</legend>

          {quotesState.status === "loading" && <p className="text-sm text-brand-muted">Fetching delivery options…</p>}

          {quotesState.status === "error" && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-brand-danger">
                {quotesState.error}
              </p>
              <button
                type="button"
                onClick={loadQuotes}
                disabled={isFetchingQuotes}
                className="self-start rounded-full border border-brand-border px-3 py-1 text-xs font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-50"
              >
                Try again
              </button>
            </div>
          )}

          {quotesState.status === "ready" && quotesState.quotes.length === 0 && (
            <p className="text-sm text-brand-muted">No delivery options are available for this listing right now.</p>
          )}

          {quotesState.status === "ready" &&
            quotesState.quotes.map((quote) => (
              <label
                key={quote.id}
                className="flex items-center justify-between gap-2 rounded-md border border-brand-border px-3 py-2 text-sm text-brand-ink has-[:checked]:border-brand-sage-dark has-[:checked]:bg-brand-sage/10"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="_deliveryQuoteChoice"
                    checked={selectedQuoteId === quote.id}
                    onChange={() => setSelectedQuoteId(quote.id)}
                    className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{serviceLevelLabel(quote.serviceLevel)}</span>
                    <span className="text-xs text-brand-muted">
                      {quote.providerName} · {etaLabel(quote)}
                    </span>
                  </span>
                </span>
                <span className="font-medium">{formatCentsAsRand(quote.priceCents)}</span>
              </label>
            ))}

          {quotesState.status === "ready" && quotesState.quotes.length > 0 && (
            <button
              type="button"
              onClick={loadQuotes}
              disabled={isFetchingQuotes}
              className="self-start text-xs font-medium text-brand-ink underline hover:no-underline disabled:opacity-50"
            >
              Refresh delivery options
            </button>
          )}

          {/* The only delivery-related value the form actually submits — a
              quote id, never a price. create_order() looks this row up
              and derives delivery_fee_cents/total_cents from it itself. */}
          <input type="hidden" name="deliveryQuoteId" value={selectedQuoteId ?? ""} />
        </fieldset>
      )}

      {fulfilment === "collection" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-brand-ink">Payment</legend>
          <label className="flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="radio"
              name="paymentMethod"
              value="online"
              defaultChecked
              className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark"
            />
            Pay online
          </label>
          {showCashOption && (
            <label className="flex items-center gap-2 text-sm text-brand-ink">
              <input type="radio" name="paymentMethod" value="cash" className="h-4 w-4 text-brand-sage-dark focus:ring-brand-sage-dark" />
              Cash on collection
            </label>
          )}
        </fieldset>
      )}

      {fulfilment === "delivery" && (
        // Delivery is always paid online (create_order() rejects
        // cash+delivery) — a hidden field keeps the form payload
        // consistent without showing a payment-method choice that would
        // only ever have one legitimate option.
        <input type="hidden" name="paymentMethod" value="online" />
      )}

      {state && "error" in state && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
          <p>{state.error}</p>
          {state.verificationRequired && (
            <Link href="/account/verification" className="font-medium underline">
              Verify your account
            </Link>
          )}
        </div>
      )}

      <PlaceOrderButton disabled={!canSubmit} />
    </form>
  );
}
