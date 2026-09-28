export class PayFastEnvironmentMisconfiguredError extends Error {}

/**
 * A safety boundary between the deployment environment and PayFast's
 * sandbox/live switch (Phase 15B, C-6 — the Phase 15A audit found
 * PAYFAST_SANDBOX is a plain application-level toggle with nothing tying
 * it to whether this is actually a production deployment).
 *
 * VERCEL_ENV is set automatically by Vercel on every deployment
 * ("production" | "preview" | "development") — nothing to configure for
 * it to be present, and it's simply absent locally (`next dev`, tests,
 * CI), where this check is a no-op so local development stays easy.
 *
 * Called from getPayFastCredentials() — this codebase's existing
 * "checked at first use" boundary (see that function's own comment) —
 * not from application startup: a PayFast misconfiguration must block
 * PayFast specifically (checkout initiation, the webhook route), never
 * take down the rest of the site the way throwing from
 * instrumentation.ts's register() would. This mirrors the same
 * failure-isolation this codebase already applies elsewhere (e.g. a
 * delivery-booking failure never fails the PayFast webhook response
 * either).
 *
 * Takes `sandbox` as a plain boolean (the caller's own isPayFastSandbox()
 * result) rather than reading config itself, so this stays a small, pure,
 * independently testable function with no dependency on — or circular
 * import risk with — config.ts.
 */
export function assertPayFastEnvironmentSafety(sandbox: boolean): void {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== "production" && vercelEnv !== "preview") return;

  if (vercelEnv === "preview" && !sandbox) {
    throw new PayFastEnvironmentMisconfiguredError(
      'PAYFAST_SANDBOX=false on a Vercel preview deployment — refusing to risk processing a live PayFast transaction from a preview environment. Set PAYFAST_SANDBOX=true (or leave it unset) for preview deployments.',
    );
  }

  if (vercelEnv === "production" && sandbox) {
    throw new PayFastEnvironmentMisconfiguredError(
      'PAYFAST_SANDBOX is not explicitly "false" on a Vercel production deployment with PayFast selected — refusing to run production payments against PayFast\'s sandbox host. Set PAYFAST_SANDBOX=false for production.',
    );
  }
}
