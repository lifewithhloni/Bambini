import { getServerEnv } from "@/config/env";

export type PayFastHosts = {
  processUrl: string;
  validateUrl: string;
  /** The exact hostnames PayFast documents as valid ITN senders — see developers.payfast.co.za/docs, "Check that the notification has come from a valid Payfast domain". */
  validSenderHosts: string[];
};

const SANDBOX_HOSTS: PayFastHosts = {
  processUrl: "https://sandbox.payfast.co.za/eng/process",
  validateUrl: "https://sandbox.payfast.co.za/eng/query/validate",
  validSenderHosts: ["sandbox.payfast.co.za"],
};

const LIVE_HOSTS: PayFastHosts = {
  processUrl: "https://www.payfast.co.za/eng/process",
  validateUrl: "https://www.payfast.co.za/eng/query/validate",
  validSenderHosts: ["www.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"],
};

export type PayFastCredentials = {
  merchantId: string;
  merchantKey: string;
  passphrase: string | undefined;
};

/**
 * Sandbox vs live is a single, explicit switch (`PAYFAST_SANDBOX`,
 * default true) — never inferred from NODE_ENV or any other implicit
 * signal, and never hardcoded to one or the other, so a deployment
 * can't accidentally end up posting to the live endpoint just because
 * some other unrelated flag happened to be set. Defaulting to sandbox
 * (rather than defaulting to live) means a missing/misconfigured
 * environment fails toward "test mode," not toward "real card
 * charges," which is the safer direction to fail in.
 */
export function isPayFastSandbox(): boolean {
  const raw = getServerEnv().PAYFAST_SANDBOX;
  return raw !== "false";
}

export function getPayFastHosts(): PayFastHosts {
  return isPayFastSandbox() ? SANDBOX_HOSTS : LIVE_HOSTS;
}

export function getPayFastCredentials(): PayFastCredentials {
  const env = getServerEnv();
  if (!env.PAYFAST_MERCHANT_ID || !env.PAYFAST_MERCHANT_KEY) {
    throw new Error(
      "PayFast is selected as the active payment provider (PAYMENT_PROVIDER=payfast) but PAYFAST_MERCHANT_ID/PAYFAST_MERCHANT_KEY are not set.",
    );
  }
  return {
    merchantId: env.PAYFAST_MERCHANT_ID,
    merchantKey: env.PAYFAST_MERCHANT_KEY,
    passphrase: env.PAYFAST_PASSPHRASE || undefined,
  };
}
