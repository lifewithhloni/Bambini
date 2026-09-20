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
};

export type BookedDelivery = {
  providerSlug: string;
  providerTrackingRef: string;
  status: DeliveryStatus;
};

export type DeliveryStatus =
  "booked" | "collected_by_courier" | "in_transit" | "delivered" | "failed" | "cancelled";

/**
 * Every delivery provider (Uber Direct, Courier Guy, Bob Go, ...)
 * implements this. Nothing outside src/server/delivery/ should import a
 * provider SDK directly — go through DeliveryProvider so a new courier is
 * "add an adapter + register it", not a marketplace-wide rewrite.
 */
export interface DeliveryProvider {
  readonly slug: string;
  getQuotes(request: DeliveryQuoteRequest): Promise<DeliveryQuote[]>;
  bookDelivery(request: BookDeliveryRequest): Promise<BookedDelivery>;
  getStatus(providerTrackingRef: string): Promise<DeliveryStatus>;
}
