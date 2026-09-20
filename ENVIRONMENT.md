# Bambini — Environment Variables

Copy `.env.example` to `.env.local` for local development. Never commit
real values — `.gitignore` blocks `.env*` except `.env.example`.

Variables are read through `src/config/env.ts` (zod-validated), not
`process.env` directly, so a missing/malformed value fails fast at
startup instead of surfacing as a bug deep in a handler.
`getPublicEnv()` only exposes `NEXT_PUBLIC_*` vars and is safe to call
from client code; `getServerEnv()` includes secrets and must only be
called from server code.

## Supabase

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | No | Project API URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No (RLS-protected) | Client/server key — every query using it is subject to Row Level Security. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Bypasses RLS entirely. Server-only (`lib/supabase/admin.ts`, guarded by the `server-only` package). Never send to the browser. |

For local development, `supabase start` prints local values for these.
For a hosted project, they're in Supabase project settings → API.

## App

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | No | Base URL used for auth redirects, payment return URLs, etc. |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | No | Defaults to `ZAR`. |

## Payments

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | No | Selects the active adapter (`src/server/payments/registry.ts`). `mock` needs no keys and is the default. |
| `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` | **Yes** | Only needed once a PayFast adapter is added and selected. |
| `YOCO_SECRET_KEY` | **Yes** | Only needed once a Yoco adapter is added and selected. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | **Yes** | Only needed once a Stripe adapter is added and selected. |

No payment provider has been integrated yet — see
[ARCHITECTURE.md](ARCHITECTURE.md#payment-architecture) and
[DECISIONS.md](DECISIONS.md) for which one to pick first.

## Delivery

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `DELIVERY_PROVIDERS` | No | Comma-separated list of active adapters (`src/server/delivery/registry.ts`). `mock` needs no keys and is the default. |
| `UBER_DIRECT_CUSTOMER_ID` / `UBER_DIRECT_CLIENT_ID` / `UBER_DIRECT_CLIENT_SECRET` | **Yes** | Only needed once an Uber Direct adapter is added and enabled. |
| `COURIER_GUY_API_KEY` | **Yes** | Only needed once a Courier Guy adapter is added and enabled. |
| `BOB_GO_API_KEY` | **Yes** | Only needed once a Bob Go adapter is added and enabled. |

## Observability (optional, not yet wired up)

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | No (DSNs are not secret) | Reserved for future error tracking. |

## Deployment (Vercel)

Set the same variables in the Vercel project's Environment Variables UI,
scoped per environment (Production / Preview / Development). Never put a
secret in a file that gets committed, and never put personal or sensitive
data in a `NEXT_PUBLIC_*` variable — those are bundled into client-side
JavaScript and are effectively public.
