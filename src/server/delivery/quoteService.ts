import "server-only";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllDeliveryQuotes } from "./registry";
import { calculateDeliveryMarkup } from "./calculateDeliveryMarkup";
import type { GeoPoint, DeliveryServiceLevel } from "./types";

export type BuyerDeliveryQuote = {
  id: string;
  serviceLevel: DeliveryServiceLevel;
  priceCents: number;
  currency: string;
  // Nullable because delivery_quotes.eta_min/max_minutes are nullable at
  // the schema level (a provider isn't required to give an ETA) — this
  // quote service always sets them from the provider's own response, so
  // in practice they're only ever null if a future provider omits one.
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
  providerName: string;
  /** ISO timestamp. Display + client-side "this is about to expire" hinting only — create_order() re-checks expiry server-side regardless. */
  expiresAt: string;
};

export type DeliveryQuoteResult = { ok: true; quotes: BuyerDeliveryQuote[] } | { ok: false; error: string };

/**
 * Phase 7A: the server-side delivery quote service (§2 of the phase
 * brief). Buyer-authenticated; every location lookup here uses the
 * admin (service-role) client deliberately — a buyer's own RLS-scoped
 * client cannot read another user's profiles.location_id/
 * businesses.location_id or any locations row it doesn't own (see
 * DECISIONS.md: "public location reads only through SECURITY DEFINER
 * functions/views, never a public RLS policy on locations"). This is
 * the application-code equivalent of that same rule: an operation that
 * has already authorized itself (product exists + is published +
 * delivery_available, buyer is signed in) reading exactly the two
 * locations it needs, never returning raw coordinates or location ids
 * to the caller — see the return type above, which carries none.
 *
 * Returns quotes already sorted cheapest-first; persists one
 * delivery_quotes row per returned quote (requested_by = this buyer,
 * product_id = this product — the two Phase 7A ownership/replay columns
 * — see 20260930090000_delivery_quoting_booking.sql) before returning,
 * so the id the buyer selects at checkout is already a real, revalidatable
 * row create_order() can look up.
 */
export async function fetchDeliveryQuotesForProduct(user: User, productId: string): Promise<DeliveryQuoteResult> {
  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .select("id, seller_type, seller_profile_id, business_id, delivery_available")
    .eq("id", productId)
    .eq("status", "published")
    .maybeSingle();

  if (error || !product) {
    return { ok: false, error: "This listing is no longer available." };
  }
  if (!product.delivery_available) {
    return { ok: false, error: "Delivery isn't available for this listing." };
  }

  const admin = createAdminClient();

  const { data: buyerProfile } = await admin.from("profiles").select("location_id").eq("id", user.id).maybeSingle();
  const buyerLocationId = buyerProfile?.location_id;
  if (!buyerLocationId) {
    return { ok: false, error: "Set your delivery location before checking out." };
  }

  let sellerLocationId: string | null = null;
  if (product.seller_type === "parent" && product.seller_profile_id) {
    const { data } = await admin.from("profiles").select("location_id").eq("id", product.seller_profile_id).maybeSingle();
    sellerLocationId = data?.location_id ?? null;
  } else if (product.seller_type === "business" && product.business_id) {
    const { data } = await admin.from("businesses").select("location_id").eq("id", product.business_id).maybeSingle();
    sellerLocationId = data?.location_id ?? null;
  }
  if (!sellerLocationId) {
    return { ok: false, error: "Delivery isn't available for this listing right now." };
  }

  const [{ data: pickupLoc }, { data: dropoffLoc }] = await Promise.all([
    admin.from("locations").select("latitude, longitude").eq("id", sellerLocationId).maybeSingle(),
    admin.from("locations").select("latitude, longitude").eq("id", buyerLocationId).maybeSingle(),
  ]);
  if (!pickupLoc || !dropoffLoc) {
    return { ok: false, error: "Delivery isn't available for this listing right now." };
  }

  const pickup: GeoPoint = { latitude: pickupLoc.latitude, longitude: pickupLoc.longitude };
  const dropoff: GeoPoint = { latitude: dropoffLoc.latitude, longitude: dropoffLoc.longitude };

  const providerQuotes = await getAllDeliveryQuotes({ pickup, dropoff });
  if (providerQuotes.length === 0) {
    return { ok: false, error: "No delivery options are available for this listing right now." };
  }

  // Registry/DB consistency guard (§4 of the phase brief): a provider
  // must be both code-registered (DELIVERY_PROVIDERS) AND active in
  // delivery_providers to actually produce a bookable quote — disabling
  // a provider's DB row is enough to pull it from checkout even if it's
  // still code-registered, and a quote whose provider slug has no
  // matching DB row at all (registry/DB drift) is silently dropped
  // rather than surfaced as a bookable-but-unbookable option.
  const { data: providerRows } = await admin.from("delivery_providers").select("id, slug, name, is_active");
  const activeProviderBySlug = new Map((providerRows ?? []).filter((p) => p.is_active).map((p) => [p.slug, p]));

  const bookable = providerQuotes
    .map((quote) => {
      const providerRow = activeProviderBySlug.get(quote.providerSlug);
      return providerRow ? { quote, providerRow } : null;
    })
    .filter((x): x is { quote: (typeof providerQuotes)[number]; providerRow: NonNullable<typeof providerRows>[number] } => x !== null);

  if (bookable.length === 0) {
    return { ok: false, error: "No delivery options are available for this listing right now." };
  }

  // Phase 7C: the current admin-configured markup rate, read ONCE per
  // quote fetch and baked into every returned quote's own
  // markup_percentage_bps — never re-read or recalculated later. This is
  // what makes "an existing order keeps the rate that was in effect when
  // its quote was fetched, even after the admin changes the global rate"
  // true: create_order() only ever copies these already-computed values
  // off the quote row, it never looks the setting up itself. See
  // delivery_markup_settings' own migration comment for why this is an
  // append-only history, mirroring commission_rates exactly.
  const { data: markupSetting } = await admin
    .from("delivery_markup_settings")
    .select("markup_percentage_bps")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Falls back to 0% only if the settings table were somehow empty
  // (never happens in practice — a default row is seeded directly in
  // the migration that creates the table) rather than failing checkout
  // entirely over a missing admin config row.
  const markupPercentageBps = markupSetting?.markup_percentage_bps ?? 0;

  const rows = bookable.map(({ quote, providerRow }) => {
    // quote.priceCents here is the PROVIDER's own raw cost — nothing
    // above this line has touched it. The buyer never sees this number;
    // BuyerDeliveryQuote (below) only ever carries the marked-up
    // buyerFeeCents.
    const markup = calculateDeliveryMarkup(quote.priceCents, markupPercentageBps);
    return {
      requested_by: user.id,
      product_id: productId,
      pickup_location_id: sellerLocationId,
      dropoff_location_id: buyerLocationId,
      provider_id: providerRow.id,
      service_level: quote.serviceLevel,
      // The buyer-facing price — provider cost + markup, never the raw
      // provider quote.
      price_cents: markup.buyerFeeCents,
      provider_cost_cents: markup.providerCostCents,
      markup_percentage_bps: markup.markupPercentageBps,
      markup_amount_cents: markup.markupAmountCents,
      currency: quote.currency,
      eta_min_minutes: quote.etaMinMinutes,
      eta_max_minutes: quote.etaMaxMinutes,
      provider_quote_ref: quote.providerQuoteRef,
      // Internal-only (never selected back out to the browser — see
      // BuyerDeliveryQuote above) audit record of exactly what the
      // provider returned, including its own (unmarked-up) price.
      raw_response: quote,
      expires_at: quote.expiresAt.toISOString(),
    };
  });

  const { data: inserted, error: insertError } = await admin
    .from("delivery_quotes")
    .insert(rows)
    .select("id, service_level, price_cents, currency, eta_min_minutes, eta_max_minutes, expires_at, provider_id");

  if (insertError || !inserted) {
    return { ok: false, error: "Could not fetch delivery options. Please try again." };
  }

  const providerNameById = new Map(bookable.map(({ providerRow }) => [providerRow.id, providerRow.name]));

  const quotes: BuyerDeliveryQuote[] = inserted
    .map((row) => ({
      id: row.id,
      serviceLevel: row.service_level,
      priceCents: row.price_cents,
      currency: row.currency,
      etaMinMinutes: row.eta_min_minutes,
      etaMaxMinutes: row.eta_max_minutes,
      providerName: providerNameById.get(row.provider_id) ?? "Delivery",
      expiresAt: row.expires_at,
    }))
    .sort((a, b) => a.priceCents - b.priceCents);

  return { ok: true, quotes };
}
