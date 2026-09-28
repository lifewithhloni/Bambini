import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

/**
 * Wires up Sentry only when SENTRY_DSN is configured — a completely
 * normal development environment (and every existing test) runs with it
 * unset and gets no Sentry behaviour at all, so this is safe by default.
 * Split by runtime per Next.js's own instrumentation contract (register()
 * is called once per server instance, for both the Node and Edge
 * runtimes — see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md,
 * consulted before writing this since this project's Next.js version may
 * differ from training-data assumptions).
 *
 * No extra integration is added here to opt into request-body/header/
 * cookie capture (the SDK's defaults already don't send them) — this
 * project reports operational failures narrowly, through its own
 * explicit call sites (see
 * src/lib/monitoring/reportOperationalFailure.ts), never arbitrary
 * request payloads.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  const runtime = process.env.NEXT_RUNTIME;
  if (runtime === "nodejs" || runtime === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0,
    });
  }
}

/** Server-rendering/route-handler errors Next.js itself catches — a no-op when Sentry was never initialized above. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  await Sentry.captureRequestError(...args);
};
