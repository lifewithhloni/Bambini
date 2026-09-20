import { getServerEnv } from "@/config/env";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./providers/mock";

const providerFactories: Record<string, () => PaymentProvider> = {
  mock: () => new MockPaymentProvider(),
  // payfast: () => new PayFastProvider(),
  // yoco: () => new YocoProvider(),
  // stripe: () => new StripeProvider(),
};

let cached: PaymentProvider | undefined;

/**
 * Unlike delivery (multiple providers quoted side by side), checkout uses
 * exactly one active payment provider at a time, selected by
 * PAYMENT_PROVIDER — swapping it is a config change, not a code change.
 */
export function getActivePaymentProvider(): PaymentProvider {
  if (!cached) {
    const slug = getServerEnv().PAYMENT_PROVIDER;
    const factory = providerFactories[slug];
    if (!factory) {
      throw new Error(`Unknown payment provider "${slug}" in PAYMENT_PROVIDER`);
    }
    cached = factory();
  }
  return cached;
}
