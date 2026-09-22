export type GeoPoint = {
  latitude: number;
  longitude: number;
};

/**
 * Deliberately excludes weight/dimensions — sellers never enter package
 * size (see ARCHITECTURE.md). Providers that need it estimate from
 * category/service level internally, or we accept a generic size tier
 * later without changing this interface.
 */
export type DeliveryQuoteRequest = {
  pickup: GeoPoint;
  dropoff: GeoPoint;
  categorySlug?: string;
};

export type DeliveryServiceLevel = "cheapest" | "standard" | "express";

export type DeliveryQuote = {
  providerSlug: string;
  serviceLevel: DeliveryServiceLevel;
  priceCents: number;
  currency: string;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  /** Opaque token the provider needs to actually book this exact quote. */
  providerQuoteRef: string;
  expiresAt: Date;
};

export type BookDeliveryRequest = {
  providerQuoteRef: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  orderId: string;
  /**
   * Phase 7B: an explicit idempotency signal, distinct from `orderId`.
   * Bambini's own booking flow (src/server/delivery/bookingService.ts)
   * already guarantees at most one bookDelivery() attempt is *started*
   * per order (reserve_delivery_order()'s unique constraint) — but that
   * guarantee is about Bambini's own database, not about the provider.
   * If a booking attempt crashes after this call reaches the provider
   * but before Bambini records the result, the only safe recovery is a
   * human checking the provider's own records (see the Phase 7B report's
   * "stuck pending" analysis) — an automatic retry would call
   * bookDelivery() again, and *this* is the value a real adapter must
   * send the provider so the provider itself can recognize a retried
   * attempt and return the original booking instead of creating a
   * second, real delivery.
   *
   * Do NOT assume any provider treats `orderId` (or this field) as
   * idempotent merely because it's present in the request — that is a
   * property of each specific provider's own API and protocol
   * (dedicated idempotency-key header, a `client_reference` field with
   * server-side dedup, etc.), which is exactly why this field exists as
   * its own explicit, required part of the interface rather than being
   * silently inferred from `orderId`: it forces every future adapter to
   * decide, deliberately, how it satisfies this guarantee for its own
   * provider — never to skip the question. MockDeliveryProvider is the
   * one adapter that actually honors it today (see providers/mock.ts);
   * no real provider integration exists yet.
   */
  idempotencyKey: string;
};

export type BookedDelivery = {
  providerSlug: string;
  providerTrackingRef: string;
  status: DeliveryStatus;
};

export type DeliveryStatus =
  "booked" | "collected_by_courier" | "in_transit" | "delivered" | "failed" | "cancelled";

/** Result of asking a provider to cancel a booking it hasn't already completed. */
export type CancelledDelivery = {
  status: Extract<DeliveryStatus, "cancelled" | "failed">;
  /** True if the provider actually cancelled something; false if it reports there was nothing left to cancel (already delivered/failed/unknown ref) — both are legitimate outcomes, never an error. */
  wasCancelled: boolean;
};

/**
 * Every delivery provider (Uber Direct, Courier Guy, Bob Go, ...)
 * implements this. Nothing outside src/server/delivery/ should import a
 * provider SDK directly — go through DeliveryProvider so a new courier is
 * "add an adapter + register it", not a marketplace-wide rewrite.
 *
 * cancelDelivery() is Phase 7A's addition — deliberately provider-agnostic
 * (a tracking ref in, a terminal status out) and deliberately minimal:
 * Phase 7A itself never calls it (no cancellation UI/flow exists yet —
 * see DECISIONS.md), it exists so the interface is complete for whoever
 * builds that flow next, without another interface-shape change.
 */
export interface DeliveryProvider {
  readonly slug: string;
  getQuotes(request: DeliveryQuoteRequest): Promise<DeliveryQuote[]>;
  bookDelivery(request: BookDeliveryRequest): Promise<BookedDelivery>;
  getStatus(providerTrackingRef: string): Promise<DeliveryStatus>;
  cancelDelivery(providerTrackingRef: string): Promise<CancelledDelivery>;
}
