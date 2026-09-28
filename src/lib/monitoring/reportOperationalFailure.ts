import "server-only";
import * as Sentry from "@sentry/nextjs";

export type OperationalArea = "payfast_webhook" | "delivery_booking" | "payout";

/**
 * The one, deliberately narrow way this codebase reports an operational
 * failure to Sentry — used only at the specific financial/operational
 * failure paths named by the Phase 15A audit (the PayFast webhook,
 * delivery booking, and payout server actions), never as a blanket wrap
 * of every console.error in the app. A no-op whenever SENTRY_DSN isn't
 * configured, since Sentry.init() is then never called (instrumentation.ts)
 * and every Sentry SDK call safely no-ops before init.
 *
 * `context` may only ever carry opaque reference ids and a short reason
 * string — the same discipline this codebase's console.error calls
 * already follow (see e.g. src/server/messaging/actions.ts's "message
 * bodies are never logged"). Never pass a message body, SA ID number,
 * document path, exact address, payment credential, or provider secret
 * here; there is intentionally no field for one.
 */
export function reportOperationalFailure(context: { area: OperationalArea; orderId?: string; payoutId?: string; reason: string }, error?: unknown): void {
  try {
    const scope = { tags: { area: context.area }, extra: { orderId: context.orderId, payoutId: context.payoutId, reason: context.reason } };
    if (error instanceof Error) {
      Sentry.captureException(error, scope);
    } else {
      Sentry.captureMessage(context.reason, scope);
    }
  } catch {
    // A monitoring call must never be able to abort the financial/
    // operational code path that's reporting through it — every caller
    // (the PayFast webhook, delivery booking, payout actions) has
    // already done its own real work and its own console.error by the
    // time this runs; this is best-effort on top of that, never a
    // dependency of it.
    console.error("reportOperationalFailure: monitoring call itself failed.");
  }
}
