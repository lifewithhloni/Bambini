# Bambini — Environment Variables

Copy `.env.example` to `.env.local` for local development. Never commit
real values — `.gitignore` blocks `.env*` except `.env.example`.

Variables are read through `src/config/env.ts` (zod-validated), not
`process.env` directly, so a missing/malformed value fails fast at
startup instead of surfacing as a bug deep in a handler.
`getPublicEnv()` only exposes `NEXT_PUBLIC_*` vars and is safe to call
from client code; `getServerEnv()` includes secrets and must only be
called from server code.

Every variable below is classified the same way:

- **Visibility** — `public` (`NEXT_PUBLIC_*`, bundled into client JS) or `server-only`.
- **Secret?** — whether the value itself must be kept out of logs/docs/version control.
- **Local** / **Preview** / **Production** — `required`, `optional`, or `—` (not applicable/not used).

## Supabase

| Variable | Visibility | Secret? | Local | Preview | Production |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | No | required | required | required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | No (RLS-protected) | required | required | required |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | **Yes** | required | required | required |

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely — it's
guarded by the `server-only` package (`src/lib/supabase/admin.ts`) so it
cannot even be imported from a client component. Never send it to the
browser.

For local development, `supabase start` prints local values for these.
For a hosted project (used for Preview and Production alike, unless you
maintain separate Supabase projects per environment — see "Production
Supabase Auth configuration" below), they're in Supabase project
settings → API.

## App

| Variable | Visibility | Secret? | Local | Preview | Production |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | public | No | optional (defaults to `http://localhost:3000`) | required | required |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | public | No | optional (defaults to `ZAR`) | optional | optional |

`NEXT_PUBLIC_SITE_URL` must be each environment's own real URL in
Preview/Production (used for auth redirects, the PayFast return/notify
URLs, etc.) — never left at the `localhost` default once deployed.

## Payments

| Variable | Visibility | Secret? | Local | Preview | Production |
| --- | --- | --- | --- | --- | --- |
| `PAYMENT_PROVIDER` | server-only | No | optional (defaults to `mock`) | optional | required once PayFast is live |
| `PAYFAST_MERCHANT_ID` | server-only | **Yes** | — | required if `PAYMENT_PROVIDER=payfast` | required if `PAYMENT_PROVIDER=payfast` |
| `PAYFAST_MERCHANT_KEY` | server-only | **Yes** | — | required if `PAYMENT_PROVIDER=payfast` | required if `PAYMENT_PROVIDER=payfast` |
| `PAYFAST_PASSPHRASE` | server-only | **Yes** | — | required if `PAYMENT_PROVIDER=payfast` | required if `PAYMENT_PROVIDER=payfast` |
| `PAYFAST_SANDBOX` | server-only | No | optional (defaults to sandbox) | **must be unset or `true`** | **must be `false`** |
| `YOCO_SECRET_KEY` | server-only | **Yes** | — | — | future — no Yoco adapter exists yet |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | server-only | **Yes** | — | — | future — no Stripe adapter exists yet |

`PAYMENT_PROVIDER` selects the active adapter (`src/server/payments/registry.ts`).
`mock` needs no keys and is the default.

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

### Preview vs. production PayFast safety (Phase 15B, C-6)

`PAYFAST_SANDBOX` is a plain application-level toggle with nothing
inherently tying it to which deployment this is — a preview build could
in principle be misconfigured with live credentials, or a production
build accidentally left on sandbox. Since Vercel automatically sets
`VERCEL_ENV` (`"production"` | `"preview"` | `"development"`) on every
deployment with nothing to configure for it, `getPayFastCredentials()`
(`src/server/payments/providers/payfast/environmentGuard.ts`) checks it
at the first actual use of PayFast and refuses to proceed if:

- `VERCEL_ENV=preview` and `PAYFAST_SANDBOX=false` (a preview deployment
  configured for live payments), or
- `VERCEL_ENV=production` and PayFast is still on sandbox (a production
  deployment that would silently process real customers' card details
  against PayFast's sandbox, where they'd simply fail).

This only blocks the PayFast payment path itself (checkout initiation,
the webhook) — it never crashes the whole server, and it's a complete
no-op locally (`next dev`, tests, CI all run with no `VERCEL_ENV` set).
**CODE CONFIGURATION** — this guard is already implemented; nothing to
set up beyond making sure `PAYFAST_SANDBOX` is actually correct per
environment (see the table above).

## Delivery

| Variable | Visibility | Secret? | Local | Preview | Production |
| --- | --- | --- | --- | --- | --- |
| `DELIVERY_PROVIDERS` | server-only | No | optional (defaults to `mock`) | optional | required once a real provider is live |
| `DELIVERY_TRACKING_POLL_COOLDOWN_SECONDS` | server-only | No | optional (defaults to `60`) | optional | optional |
| `UBER_DIRECT_CUSTOMER_ID` / `UBER_DIRECT_CLIENT_ID` / `UBER_DIRECT_CLIENT_SECRET` | server-only | **Yes** | — | — | future — no Uber Direct adapter exists yet |
| `COURIER_GUY_API_KEY` | server-only | **Yes** | — | — | future — no Courier Guy adapter exists yet |
| `BOB_GO_API_KEY` | server-only | **Yes** | — | — | future — no Bob Go adapter exists yet |

`DELIVERY_PROVIDERS` is a comma-separated list of active adapters
(`src/server/delivery/registry.ts`). `mock` needs no keys and is the
default; every provider-specific key above is a placeholder for an
adapter that doesn't exist in the codebase yet — setting one has no
effect until the matching adapter is written and registered.

## Observability (Phase 15B, C-1)

| Variable | Visibility | Secret? | Local | Preview | Production |
| --- | --- | --- | --- | --- | --- |
| `SENTRY_DSN` | server-only | No (a DSN isn't itself a secret) | optional | recommended | recommended |

Wired up via `src/instrumentation.ts` — see the top of that file. Never
set this as `NEXT_PUBLIC_SENTRY_DSN` or otherwise expose it to client
code; the integration is entirely server/edge-runtime side, matching
where this project actually reports operational failures (the PayFast
webhook, delivery booking, and payout server actions — see
`src/lib/monitoring/reportOperationalFailure.ts`). Leaving it unset is
fully supported: `Sentry.init()` is simply never called, and every
reporting call becomes a no-op.

Not sent to Sentry, by design: message bodies, SA ID numbers, document
paths, exact addresses, payment credentials, provider secrets, or
arbitrary request bodies — `reportOperationalFailure()`'s only inputs
are an area tag, an order/payout id, and a short reason string.
**MANUAL PRODUCTION CONFIGURATION** — creating a Sentry project and
obtaining its DSN happens outside this repository; set the resulting
value as `SENTRY_DSN` in Vercel's environment variables.

## Deployment (Vercel)

Set the same variables in the Vercel project's Environment Variables UI,
scoped per environment (Production / Preview / Development). Never put a
secret in a file that gets committed, and never put personal or sensitive
data in a `NEXT_PUBLIC_*` variable — those are bundled into client-side
JavaScript and are effectively public.

`VERCEL_ENV` itself needs no configuration — Vercel sets it automatically
on every deployment, and this project reads it (see the PayFast section
above) purely as a safety signal, never as a source of secrets.

## Production Supabase Auth configuration (Phase 15B, C-5)

The Phase 15A audit found that signup/login abuse protection relies on
Supabase Auth's own built-in behaviour rather than a custom
application-level rate limiter — this repository does not (and should
not) build one unless real evidence later shows Supabase's own limits are
insufficient. What it *does* need is confirmation that the production
Supabase project is actually configured correctly, since
`supabase/config.toml`'s `[auth]` section only governs local
`supabase start` — it has no effect on a hosted project.

**CODE CONFIGURATION** (already implemented, nothing to do):
- Email confirmation is required before `auth.users.email_confirmed_at`
  is set, and the app already branches on that (`signUp()` in
  `src/server/auth/actions.ts` returns `{ confirmationSent: true }`
  rather than an active session until the link is clicked).
- Login failures return a deliberately generic "Incorrect email or
  password" message (`signIn()`, same file) — this prevents an attacker
  from using the error message itself to enumerate registered emails;
  it does not replace rate limiting.
- The PayFast preview/production credential guard above is also part of
  this project's production-readiness posture, though it's a payments
  concern, not an Auth one.

**SUPABASE DASHBOARD CONFIGURATION** — none of the following exists in
this repository; each must be set directly in the hosted project's
Authentication settings before go-live, and re-checked whenever a new
deployment environment (e.g. a new preview domain pattern) is added:

- [ ] **Site URL** — set to the real production `NEXT_PUBLIC_SITE_URL`,
      not `http://127.0.0.1:3000` (the `config.toml` dev default).
- [ ] **Additional Redirect URLs** — every real domain that needs to
      complete an auth redirect: the production domain, and (if Preview
      deployments need working auth) either Vercel's preview URL
      pattern or a dedicated allowlist. Do not leave only the local dev
      value here.
- [ ] **Email confirmation requirement** — confirm "Confirm email" is
      enabled in Production the same way `config.toml` enables it
      locally; this is a per-project dashboard toggle, not something
      migrations control.
- [ ] **Password policy** — set the production project to match the
      app's own policy exactly: Dashboard → Authentication → Policies →
      Password Requirements — **Minimum password length: 12**,
      **Required characters: Lowercase, uppercase, digits, and symbols**
      (same as `supabase/config.toml`'s `minimum_password_length`/
      `password_requirements`, which only take effect locally/on a
      freshly-bootstrapped project — the live production project needs
      this set by hand). The application's own check
      (`checkPasswordStrength()`, `src/server/auth/validation.ts`) is
      authoritative and already enforces this; this Dashboard setting is
      the independent backstop so a direct API request can't bypass it.
      Also consider enabling **Leaked Password Protection** (Dashboard →
      Authentication → Policies) — it checks new passwords against
      HaveIBeenPwned's breach database. It's a Dashboard-only feature
      with no equivalent key in `supabase/config.toml` for this CLI
      version; this repo doesn't enable it and makes no judgement call
      on it for you — see DECISIONS.md for how to record the call if you
      make one.
- [ ] **MFA and any other auth configuration** — any additional
      multi-factor settings the team wants, reviewed against Supabase's
      current defaults (defaults can change between Supabase platform
      versions; this repo doesn't pin them).
- [ ] **Auth rate-limit settings** — review Supabase's built-in
      rate-limit configuration for the production project (signup,
      sign-in, OTP/email-send limits) rather than assuming the
      platform default is right for this app's expected traffic.
- [ ] **Production email configuration** — Supabase's default email
      sending has its own rate limits meant for development; production
      needs a configured SMTP provider (or Supabase's paid email
      add-on) so confirmation/reset emails are reliable at real volume.
- [ ] **Remove development URLs** — once production is live, confirm
      `http://127.0.0.1:3000`/`http://localhost:3000` are not left in
      the production project's redirect allowlist (they should only
      ever be needed for `supabase start`'s own local config).
- [ ] **Localhost restrictions** — same idea from the other direction:
      confirm the production Supabase project's CORS/redirect
      allowlist doesn't implicitly trust `localhost` origins.
- [ ] **Preview URL handling** — decide, explicitly, whether Preview
      deployments get real auth against the same Supabase project
      (in which case their URLs need to be in the redirect allowlist)
      or a separate Supabase project entirely. This repository doesn't
      prescribe one over the other — either is a valid MANUAL PRODUCTION
      CONFIGURATION decision, but it must be made deliberately, not left
      to whatever the allowlist happens to already contain.

None of the checklist items above can be verified or completed from
this repository — they are Supabase dashboard state, not code, and
nothing here pretends otherwise.
