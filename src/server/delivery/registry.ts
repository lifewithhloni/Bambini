import { getServerEnv } from "@/config/env";
import type { DeliveryProvider } from "./types";
import { MockDeliveryProvider } from "./providers/mock";

/**
 * Add a real provider by writing its adapter under providers/ and
 * registering it here — nothing else in the codebase changes. Which
 * adapters are active is config (DELIVERY_PROVIDERS), not code, so
 * enabling Courier Guy in production doesn't require a deploy of new
 * checkout logic.
 */
const providerFactories: Record<string, () => DeliveryProvider> = {
  mock: () => new MockDeliveryProvider(),
  // uber_direct: () => new UberDirectProvider(),
  // courier_guy: () => new CourierGuyProvider(),
  // bob_go: () => new BobGoProvider(),
};

let cachedProviders: DeliveryProvider[] | undefined;

export function getActiveDeliveryProviders(): DeliveryProvider[] {
  if (!cachedProviders) {
    const slugs = getServerEnv()
      .DELIVERY_PROVIDERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    cachedProviders = slugs.map((slug) => {
      const factory = providerFactories[slug];
      if (!factory) {
        throw new Error(`Unknown delivery provider "${slug}" in DELIVERY_PROVIDERS`);
      }
      return factory();
    });
  }
  return cachedProviders;
}

/** Fetches quotes from every active provider in parallel and merges them. */
export async function getAllDeliveryQuotes(request: Parameters<DeliveryProvider["getQuotes"]>[0]) {
  const providers = getActiveDeliveryProviders();
  const results = await Promise.all(providers.map((p) => p.getQuotes(request)));
  return results.flat();
}
