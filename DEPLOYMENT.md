# Bambini — Deployment Runbook

Phase 15C/16. This is a **repository-grounded** runbook: every fact and
step below carries exactly one of three labels, and the label is the
authoritative statement of what's actually true — no prose elsewhere in
this document overrides it.

- **REPOSITORY-VERIFIED** — checked directly against this repository
  (source, migrations, config, test runs, a compiled build). True right
  now, independent of any external account.
- **MANUAL PRODUCTION CONFIGURATION** — a setting that must be made in an
  external dashboard (Supabase, Vercel, Sentry, PayFast). Nothing in this
  repository can do this, and nothing here claims it's been done.
- **MANUAL PRODUCTION VERIFICATION REQUIRED** — a fact that can only be
  confirmed by actually looking at the real, deployed system (not by
  reading source). Distinct from configuration: this is "go check," not
  "go set."

No project ID, URL, API key, merchant ID, password, DSN, or webhook
secret is invented anywhere in this document — every value shown is
either a placeholder name or a fact this repository can prove.

See [ENVIRONMENT.md](ENVIRONMENT.md) for the full per-variable
classification; the table below is the condensed cross-environment view
Phase 15C's own brief asked for.

## Production environment matrix

| Variable | Local | Preview | Production | Public/Secret | Required? |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase start` value | project URL | project URL | Public | Always |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase start` value | project anon key | project anon key | Public (RLS-protected) | Always |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase start` value | project service key | project service key | **Secret** | Always |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` (default) | real preview URL | real production domain | Public | Always (never left at the dev default once deployed) |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | `ZAR` (default) | `ZAR` | `ZAR` | Public | Optional |
| `PAYMENT_PROVIDER` | `mock` (default) | `mock` or `payfast` | `payfast` once live | Server-only | Optional until PayFast goes live |
| `PAYFAST_MERCHANT_ID` | unset | sandbox value | **live** value | **Secret** | Required once `PAYMENT_PROVIDER=payfast` |
| `PAYFAST_MERCHANT_KEY` | unset | sandbox value | **live** value | **Secret** | Required once `PAYMENT_PROVIDER=payfast` |
| `PAYFAST_PASSPHRASE` | unset | sandbox value | **live** value | **Secret** | Required once `PAYMENT_PROVIDER=payfast` |
| `PAYFAST_SANDBOX` | unset/`true` | **must be `true` or unset** | **must be `false`** | Server-only | See the guard below |
| `VERCEL_ENV` | not present | set automatically by Vercel | set automatically by Vercel | Server-only | Nothing to configure — Vercel provides it |
| `SENTRY_DSN` | unset (fully supported) | recommended | recommended | Server-only (not secret, but never public) | Optional |
| `DELIVERY_PROVIDERS` | `mock` (default) | `mock` | `mock` until a real adapter exists | Server-only | Optional |
| `DELIVERY_TRACKING_POLL_COOLDOWN_SECONDS` | `60` (default) | `60` | tune per real provider once selected | Server-only | Optional |
| `UBER_DIRECT_*` / `COURIER_GUY_API_KEY` / `BOB_GO_API_KEY` | unset | unset | unset | **Secret** | **Future** — no adapter exists in the codebase yet; setting these has no effect |
| `YOCO_SECRET_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | unset | unset | unset | **Secret** | **Future** — no adapter exists in the codebase yet |
| Resend / email-provider variables | — | — | — | — | **Absent.** No email/SMS provider is integrated anywhere in this codebase (confirmed by the Phase 15A audit and re-confirmed for this phase — no `resend`/`nodemailer`/`sendgrid`/`twilio` reference exists in `src/` or `package.json`). Production confirmation/reset emails rely entirely on Supabase Auth's own email sending — see step 5 below. |

No value above was invented; every "required/optional" judgment is
derived from `src/config/env.ts`'s zod schema and how each variable is
actually read in code.

## Order of operations

Each step names what's actually verifiable from this repository vs. what
needs a human with dashboard access. **MANUAL PRODUCTION CONFIGURATION**
steps were not, and could not be, performed from this development
environment — there is no network path from here to a real Supabase,
Vercel, Sentry, or PayFast account.

### 1. Supabase project — MANUAL PRODUCTION CONFIGURATION
Create the production Supabase project (and, if the team decides Preview
deployments should have their own isolated auth/data — see step 5 — a
second project for that). Record the project URL, anon key, and
service-role key somewhere secure; they're needed for step 6.

### 2. Supabase environment configuration — MANUAL PRODUCTION CONFIGURATION
In the new project's dashboard: Authentication settings (full checklist
in [ENVIRONMENT.md](ENVIRONMENT.md#production-supabase-auth-configuration-phase-15b-c-5)),
and confirm the project's Postgres version is compatible (this repo's
migrations were written against Postgres 17, matching `supabase/config.toml`'s
`[db] major_version = 17`).

### 3. Database migration
**REPOSITORY-VERIFIED** — all 43 files under `supabase/migrations/` apply in
filename order (verified — no gaps, no out-of-order timestamps) and were
proven to replay cleanly against a real, fresh Postgres engine by this
project's own `tests/db/*` suite (754 tests, run via `npm run test:db`,
which boots a real Postgres — PGlite — and replays every migration file
before running anything). The newest migration,
`20261014090000_storage_bucket_provisioning.sql`, is idempotent
(`insert ... on conflict (id) do update`) — safe to run on a project
that already has the buckets (from `supabase/config.toml`'s local-dev
sync) and safe to re-run.
**MANUAL PRODUCTION CONFIGURATION** — actually running
`supabase db push` (or the CLI's equivalent) against the real production
project. This development environment has no network path to a real
Supabase project (no `supabase` CLI is even installed here, and no
project is linked — `supabase/.temp` has no `project-ref`), so **this
migration replay has only been verified against PGlite, never against
the real hosted Postgres/Storage engine** — see DATABASE.md's own "not a
substitute for the real Supabase CLI + Docker stack" caveat, which
applies equally here. Do not skip a final `supabase db push` dry-run/
review before the real one.

**MANUAL PRODUCTION CONFIGURATION — seed data.** Migrations alone leave
a fresh database structurally complete but functionally unusable:
`supabase/seed.sql` is what actually inserts the category taxonomy, the
commission rates, the `mock` payment/delivery provider activation rows,
and the cash-eligibility criteria — without it, listing creation,
checkout, and cash eligibility all have nothing to reference. Two things
to do deliberately, not automatically:
1. Apply `seed.sql`'s statements once against production — **never** via
   `supabase db reset` (that command drops and recreates the database;
   it is a local-dev-only operation and must never be pointed at a
   production project).
2. Review `payment_providers`/`delivery_providers` before or after
   seeding: the seed only activates `mock`. Activating `payfast` (and
   deactivating `mock`) is a separate, deliberate step — see step 11
   below and [ENVIRONMENT.md](ENVIRONMENT.md#payments)'s note that
   `PAYMENT_PROVIDER` and `payment_providers.is_active` must be changed
   together.
`seed.sql` itself has no `ON CONFLICT` guards — it is written for a
one-time `db reset` on an empty local database, not for a safe re-run.
Re-running it as-is against a database that already has this data would
duplicate categories and error on the unique constraints
(`commission_rates`, `payment_providers.slug`, etc.) — treat it as a
single, one-time production step, not something to replay.

### 4. Storage verification
**REPOSITORY-VERIFIED** — see [Storage verification](#3-supabase-storage-verification)
in the audit section below — bucket config, RLS, and signed-URL usage
are all verified from source. **MANUAL PRODUCTION VERIFICATION
REQUIRED** — confirming the buckets actually exist with the right
config *on the real project* after step 3's migration runs (the exact
checks are listed in that section).

### 5. Auth configuration — MANUAL PRODUCTION CONFIGURATION
Full checklist: [ENVIRONMENT.md](ENVIRONMENT.md#production-supabase-auth-configuration-phase-15b-c-5).
Decide explicitly whether Preview deployments share the production
Supabase project (add their URLs to the redirect allowlist) or get a
separate project — this repository intentionally doesn't choose for you.

### 6. Vercel environment variables — MANUAL PRODUCTION CONFIGURATION
Set every variable from the matrix above in the Vercel project's
Environment Variables UI, scoped correctly per environment (Production /
Preview / Development) — most importantly `PAYFAST_SANDBOX` (`false` in
Production, `true`/unset in Preview — the repository-level guard added in
Phase 15B, `assertPayFastEnvironmentSafety()`, will refuse to process a
PayFast payment if these are set backwards, but it cannot set them
correctly for you).

### 7. Sentry — MANUAL PRODUCTION CONFIGURATION
Create a Sentry project (Next.js platform), copy its DSN, set it as
`SENTRY_DSN` in Vercel for Preview and Production. **REPOSITORY-VERIFIED** —
the integration is already wired (`src/instrumentation.ts`) and fully
inert without a DSN — no code change is needed for the DSN itself to
start working once set.

### 8. PayFast sandbox — MANUAL PRODUCTION CONFIGURATION
Create/use a PayFast sandbox merchant account, set
`PAYFAST_MERCHANT_ID`/`PAYFAST_MERCHANT_KEY`/`PAYFAST_PASSPHRASE` for
Preview, leave `PAYFAST_SANDBOX` unset or `true`. Exact steps in
[PayFast verification](#6-payfast-verification) below.

### 9. Vercel preview deployment
**REPOSITORY-VERIFIED** — push a branch / open a PR and the Phase 15B CI
workflow (`.github/workflows/validate.yml`) runs automatically and must
pass before merge; its YAML has been validated and its five steps
confirmed to run in this repository. Vercel's own GitHub integration
deploys the PR to a preview URL independently of CI (this repo doesn't
run deployment from GitHub Actions, by design). **MANUAL PRODUCTION
CONFIGURATION** — connecting the Vercel project to this GitHub repo in
the first place, if not already done.

### 10. Preview smoke test
Run the **SANDBOX TEST** rows of [SMOKE_TESTS.md](SMOKE_TESTS.md)
against the preview URL from step 9.

### 11. Production PayFast configuration — MANUAL PRODUCTION CONFIGURATION
Once the sandbox flow in step 10 is verified end to end, switch to
PayFast's live account, set the live
`PAYFAST_MERCHANT_ID`/`PAYFAST_MERCHANT_KEY`/`PAYFAST_PASSPHRASE` and
`PAYFAST_SANDBOX=false` **in Vercel's Production environment only** —
never Preview. Register the production webhook URL
(`{NEXT_PUBLIC_SITE_URL}/api/payments/payfast/webhook`) with PayFast per
their dashboard's ITN settings.

### 12. Vercel production deployment — MANUAL PRODUCTION CONFIGURATION
Merge to `main` (this repo's `push: branches: [main]` CI trigger runs the
same validation suite one more time) and let Vercel's production
deployment run.

### 13. Production read-only smoke test
Run the **PRODUCTION READ-ONLY CHECK** rows of
[SMOKE_TESTS.md](SMOKE_TESTS.md) against the live production URL —
browsing, search, an existing account's pages — nothing that creates a
real order, a real payment, or a real payout. Do not run the
**PRODUCTION TRANSACTION TEST** rows without the team explicitly
deciding to (they involve real money moving through PayFast live).

### 14. Monitoring verification — MANUAL PRODUCTION VERIFICATION REQUIRED
Deliberately trigger one observable, harmless failure (e.g. a single
malformed request to the PayFast webhook URL with a bad signature — this
is safe: it's rejected before any database write happens, see
[route.ts](src/app/api/payments/payfast/webhook/route.ts)) and confirm
the resulting event actually appears in the Sentry project from step 7.
This is the only way to confirm the DSN, project, and network path are
all actually correct — nothing in the repository can prove this on its
own.

## Known, deliberately out-of-scope gaps

Carried forward from Phase 15A/15B, not addressed here (see those
phases' reports for why): no clawback mechanism for a disputed order
that was already paid out; payout recovery can't detect a real-world
double-pay through an unobserved bank-side success; refunds are
schema-only; notification-producer failures are Postgres `WARNING`s
only, not Sentry-visible.
