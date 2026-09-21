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
| `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` | **Yes** | Required once `PAYMENT_PROVIDER=payfast`. From your PayFast account's Settings page (sandbox or live). |
| `PAYFAST_PASSPHRASE` | **Yes** | Required for PayFast in practice (their signature algorithm accepts an unset passphrase, but PayFast requires one to be set on the account for anything beyond the most basic testing). Set under Settings → "Salt Passphrase" on the PayFast account. |
| `PAYFAST_SANDBOX` | No | `true` (default, including when unset) uses `sandbox.payfast.co.za`; `"false"` (the literal string) switches to the live `www.payfast.co.za` host. Defaults to sandbox specifically so a missing/misconfigured value fails toward "test mode," never toward real charges. |
| `YOCO_SECRET_KEY` | **Yes** | Only needed once a Yoco adapter is added and selected. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | **Yes** | Only needed once a Stripe adapter is added and selected. |

**PayFast is the first real provider integrated (Phase 4B)** — see
[ARCHITECTURE.md](ARCHITECTURE.md#payment-architecture) and
[DECISIONS.md](DECISIONS.md) for why. Selecting it takes two
independent steps that must be done together: set
`PAYMENT_PROVIDER=payfast` here, **and** set
`payment_providers.is_active = true` for the `payfast` row (and
`false` for `mock`) in the database — the env var picks which adapter
*code* runs; the database flag picks which provider a *new order*
attaches to at creation. Both default to `mock`/inactive, so a fresh
environment behaves exactly as before until explicitly reconfigured.

PayFast's webhook (their "ITN" — Instant Transaction Notification)
needs a **publicly reachable** URL — `{NEXT_PUBLIC_SITE_URL}/api/payments/payfast/webhook`
— to actually receive payment confirmations. This means:
- Real end-to-end sandbox testing requires either a deployed
  environment or a local tunnel (e.g. ngrok) exposing that route,
  neither of which is available in this development environment (no
  internet-exposed endpoint here) — see DECISIONS.md for what has and
  hasn't been verified as a result.
- `PAYFAST_MERCHANT_ID`/`PAYFAST_MERCHANT_KEY`/`PAYFAST_PASSPHRASE` are
  not present in this repository or its `.env.local` — no real or
  sandbox PayFast credentials have been configured anywhere in this
  project.

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
