import { randomUUID } from "node:crypto";
import { haversineDistanceKm } from "@/lib/geo";
import type {
  BookDeliveryRequest,
  BookedDelivery,
  CancelledDelivery,
  DeliveryProvider,
  DeliveryQuote,
  DeliveryQuoteRequest,
  DeliveryStatus,
} from "../types";

/**
 * Deterministic local-dev/test provider. No network calls, no API keys —
 * this is what DELIVERY_PROVIDERS=mock selects, so the checkout flow is
 * exercisable without any courier account.
 */
export class MockDeliveryProvider implements DeliveryProvider {
  readonly slug = "mock";
  private readonly bookings = new Map<string, DeliveryStatus>();

  async getQuotes(request: DeliveryQuoteRequest): Promise<DeliveryQuote[]> {
    const distanceKm = haversineDistanceKm(request.pickup, request.dropoff);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    const tiers: Array<{
      level: DeliveryQuote["serviceLevel"];
      baseCents: number;
      perKmCents: number;
      etaMin: number;
      etaMax: number;
    }> = [
      { level: "cheapest", baseCents: 2000, perKmCents: 150, etaMin: 180, etaMax: 300 },
      { level: "standard", baseCents: 3500, perKmCents: 250, etaMin: 90, etaMax: 180 },
      { level: "express", baseCents: 6000, perKmCents: 400, etaMin: 30, etaMax: 60 },
    ];

    return tiers.map((tier) => ({
      providerSlug: this.slug,
      serviceLevel: tier.level,
      priceCents: Math.round(tier.baseCents + tier.perKmCents * distanceKm),
      currency: "ZAR",
      etaMinMinutes: tier.etaMin,
      etaMaxMinutes: tier.etaMax,
      providerQuoteRef: randomUUID(),
      expiresAt,
    }));
  }

  async bookDelivery(_request: BookDeliveryRequest): Promise<BookedDelivery> {
    const trackingRef = randomUUID();
    this.bookings.set(trackingRef, "booked");
    return { providerSlug: this.slug, providerTrackingRef: trackingRef, status: "booked" };
  }

  async getStatus(providerTrackingRef: string): Promise<DeliveryStatus> {
    return this.bookings.get(providerTrackingRef) ?? "failed";
  }

  async cancelDelivery(providerTrackingRef: string): Promise<CancelledDelivery> {
    const current = this.bookings.get(providerTrackingRef);
    if (!current || current === "delivered" || current === "failed" || current === "cancelled") {
      return { status: "failed", wasCancelled: false };
    }
    this.bookings.set(providerTrackingRef, "cancelled");
    return { status: "cancelled", wasCancelled: true };
  }
}
