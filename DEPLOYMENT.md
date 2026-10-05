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
| `PHONE_VERIFICATION_ENABLED` | unset | unset | `true` only after the SMS hook is connected and tested | Server-only | Optional — leave off until SMS works |
| `SEND_SMS_HOOK_SECRET` | unset | unset until tested | Supabase-generated `v1,whsec_…` | Server-only, **Secret** | Required for the SMS hook |
| `SMSMESSENGER_EMAIL` / `SMSMESSENGER_API_TOKEN` | unset | unset until tested | SMSMessenger credentials | Server-only, **Secret** | Required for the SMS hook |
| `PHONE_THROTTLE_HASH_SECRET` | unset | any 16+ chars | random 16+ chars | Server-only, **Secret** | Required for the SMS hook |
| `PHONE_GLOBAL_SMS_HOURLY_LIMIT` | unset (default 200) | optional | optional | Server-only | Optional emergency spend ceiling |
| `SENTRY_DSN` | unset (fully supported) | recommended | recommended | Server-only (not secret, but never public) | Optional |
| `DELIVERY_PROVIDERS` | `mock` (default) | `mock` | `mock` until a real adapter exists | Server-only | Optional |
| `DELIVERY_TRACKING_POLL_COOLDOWN_SECONDS` | `60` (default) | `60` | tune per real provider once selected | Server-only | Optional |
| `UBER_DIRECT_*` / `COURIER_GUY_API_KEY` / `BOB_GO_API_KEY` | unset | unset | unset | **Secret** | **Future** — no adapter exists in the codebase yet; setting these has no effect |
| `YOCO_SECRET_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | unset | unset | unset | **Secret** | **Future** — no adapter exists in the codebase yet |
| Resend / email-provider variables | — | — | — | — | **Absent for email.** No email provider is integrated anywhere in this codebase (confirmed by the Phase 15A audit — no `resend`/`nodemailer`/`sendgrid`/`twilio` reference exists in `src/` or `package.json`). SMS is separate: the SMSMessenger hook adapter exists but is inactive until the steps in "Connecting SMS" are done. Production confirmation/reset emails rely entirely on Supabase Auth's own email sending — see step 5 below. |

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

## Connecting SMS: Supabase Send SMS hook → SMSMessenger (Phases 15A.1–15A.3 — NOT yet done in production)

The code is in the repository; **production SMS is OFF** and nothing below
has been performed. Supabase Auth keeps generating/verifying the OTP and
setting `phone_confirmed_at`; Bambini's hook endpoint
(`/api/hooks/send-sms`) only transports the code via SMSMessenger. No
provider credentials exist in the repository. Do these **in order**:

1. **Pilot gate (recommended before production).** Against a staging
   Supabase project: send real OTPs to Vodacom, MTN, Cell C and Telkom SIMs and
   record latency/success; confirm sender ID/branding and any required
   wording; confirm SMSMessenger's real HTTP/error behaviour, what happens
   when credit runs out, and low-balance alerting; and **confirm the hook
   payload carries `sms.phone` (the new number) on a `phone_change`** — the
   hook refuses to send without it and never falls back to `user.phone`.
2. **Apply migrations** `20261016090000_phone_verification_throttle.sql` (the
   service-role-only abuse-counter table; no numbers or codes) **and**
   `20261016090100_revoke_client_write_profiles_phone.sql` (removes client
   INSERT/UPDATE on legacy `profiles.phone`). The hook has no migration of its
   own: it reuses the same throttle store. Without the table, every send fails closed.
3. **Vercel (Production; separate values for Preview/staging):** set
   `SMSMESSENGER_EMAIL`, `SMSMESSENGER_API_TOKEN`, `PHONE_THROTTLE_HASH_SECRET`
   (random, 16+ chars), optionally `PHONE_GLOBAL_SMS_HOURLY_LIMIT`. Leave
   `PHONE_VERIFICATION_ENABLED` **unset**. Deploy.
4. **Supabase Dashboard → Authentication → Hooks → Send SMS:** enable it with
   URL `https://<production domain>/api/hooks/send-sms`; Supabase generates the
   `v1,whsec_…` secret — copy it to Vercel as `SEND_SMS_HOOK_SECRET` and
   redeploy. Enable the **Phone** provider (the hook replaces Supabase's own SMS
   sending; no provider credentials go in Supabase). Keep OTP length 6.
5. **Supabase Dashboard rate limits / expiry:** set SMS-per-hour and token
   verification limits appropriately and **shorten the SMS OTP expiry**
   (≈5–10 minutes) to make code guessing unattractive; consider CAPTCHA.
6. **SMSMessenger dashboard:** fund the account, set a low-balance alert,
   restrict who can view message logs (they contain the codes), and **do not
   configure delivery-report callbacks** (deliberately not implemented).
7. **Dry run with the flag OFF:** trigger a send from a test account; the hook
   must refuse (403) and no SMS must be sent — this proves the kill switch.
8. **Enable:** set `PHONE_VERIFICATION_ENABLED=true`, test with your own
   numbers, watch Sentry (area `phone_verification`) and the SMSMessenger balance.

Side effects to accept knowingly: enabling the Phone provider makes
phone-based sign-in reachable at the Auth API (the hook refuses to text
accounts with no email, but Auth may still create an unusable phone-only
user row — unverified, see SMOKE_TESTS A8); and delivery reporting is
intentionally deferred (SMSMessenger's HMAC-SHA1 callbacks would need a
public endpoint and nonce store, and verification doesn't depend on them).

**MANUAL PRODUCTION CONFIGURATION** — everything above happens outside this
repository. Local hook testing: see the commented-out
`[auth.hook.send_sms]` block in `supabase/config.toml` (supported by CLI
2.118.0; disabled by default).

## Staging environment for the SMS pilot (Phase 15A.4 — required BEFORE any real SMS)

**Status: NOT SET UP.** Nothing in this repository, and nothing reachable from
the development environment, shows a separate staging Supabase project or a
separate staging Vercel deployment: there is no `.vercel/` link, no staging
config or environment file, `.env.local` points at a placeholder Supabase URL,
and step 5 above records that the choice (shared vs separate Supabase for
Preview) was deliberately left open. So the pilot has **not** been run and no
real SMS has been sent. Until the checks below pass, treat every Preview URL
as potentially sharing the production Supabase project.

**Why a real staging project is non-negotiable for the pilot:** the hook sends
real texts, and enabling the Phone provider changes the Auth API surface
(phone sign-in becomes reachable). Neither may happen on the production
Supabase project, and the pilot's SMSMessenger credentials must never be
readable by ordinary Preview deployments.

### Recommended topology

| Piece | Pilot choice | Why |
| --- | --- | --- |
| Supabase | A **new, separate project** ("bambini-staging") | Isolated Auth, data and hook config; the hook URL and secret are per project |
| Vercel | A **separate Vercel project** from the same GitHub repo, with its **Production Branch set to a `staging` branch** | Gives a stable domain for the hook URL; its environment variables can never reach the real production project or ordinary PR previews |
| Payments in staging | `PAYMENT_PROVIDER=mock` | In that project Vercel reports `VERCEL_ENV=production`, so the PayFast guard would refuse a sandbox PayFast there. The phone pilot needs no payments |
| Alternative | One Vercel project + a `staging` branch with Preview variables scoped to that branch only (or a Vercel Custom Environment, if your plan has it) | Workable, but a mis-scoped variable then leaks to every PR preview — the reason the separate project is recommended |

### Manual setup (do in this order; none of it is done)

1. **Create the staging Supabase project** (same Postgres major version, 17). Record its
   project ref. Confirm the ref is **different from production's** before
   continuing.
2. **Apply the migrations to staging only.** With the Supabase CLI:
   `supabase link --project-ref <STAGING ref>` then `supabase db push`. First run
   `supabase projects list` and read the linked ref back — a wrong link here
   would apply the pending phone migrations to production. This includes
   `20261016090000` and `20261016090100`.
3. **Create test users in the Dashboard** (Authentication → Users → Add user, auto-confirm
   email) instead of relying on signup emails (default Supabase email sending is
   heavily rate-limited). Give them `Correct-Horse9`-style policy-compliant passwords you
   keep out of the repo.
4. **Staging Supabase Auth configuration:**
   - Authentication → Providers → **Phone**: enable. Do **not** enter any SMS
     provider credentials (the hook replaces Supabase's own sending).
   - Authentication → Hooks → **Send SMS**: enable, type HTTPS, URL
     `https://<staging domain>/api/hooks/send-sms`. Supabase generates the
     `v1,whsec_…` secret — copy it straight into the staging Vercel project as
     `SEND_SMS_HOOK_SECRET`; never paste it anywhere else.
   - Authentication → Rate limits: SMS per hour small for the pilot (e.g. 30), token
     verifications as default or lower.
   - Authentication → Providers → Phone → **SMS OTP expiry**: 300–600 seconds if the
     dashboard allows it (not verified here — record what it actually permits).
   - CAPTCHA (hCaptcha/Turnstile): optional for the pilot; if enabled, the UI
     needs the matching site-key work (not built) — leave off and note it.
   - Site URL / redirect allowlist: the staging domain.
   - **Do not** set `[auth.sms.test_otp]` (a config-file/CLI feature; it must never
     be applied to hosted projects).
5. **SMSMessenger pilot account:** register, take the free 100-SMS trial or buy the
   **smallest** pack; **ask their support, in writing:** the exact per-SMS price
   for your volume and whether OTP traffic is the same price, VAT treatment,
   minimum purchase, credit expiry, sender-ID options (and whether a branded
   ID is possible/needed for SA), whether they provide low-balance alerts, and
   whether the API token can be scoped or an IP allowlist applied. Set the
   low-balance alert; give dashboard access to named operators only (message
   logs contain the codes) and enable any 2FA they offer. If a second account
   is possible, use a **pilot-only** account so the production token is never
   exposed to staging.
6. **Staging Vercel project:** import the repo, set Production Branch = `staging`,
   create the `staging` branch from the commit to test (a human action — this
   assistant does not push branches). Set **staging-only** values:
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
   (all from the **staging** Supabase project), `NEXT_PUBLIC_SITE_URL` (staging
   domain), `PAYMENT_PROVIDER=mock`, `SEND_SMS_HOOK_SECRET`, `SMSMESSENGER_EMAIL`,
   `SMSMESSENGER_API_TOKEN`, `PHONE_THROTTLE_HASH_SECRET` (generated:
   `openssl rand -base64 32`), optionally `PHONE_GLOBAL_SMS_HOURLY_LIMIT` (e.g. 20).
   Start with `PHONE_VERIFICATION_ENABLED` **unset**.
7. **Pin the function region** near the staging Supabase region (the hook has a
   5-second total budget and makes up to three throttle RPCs plus the provider
   call; record the real hook latency from the Vercel logs during the pilot).
8. Run the **pre-flight isolation checks** below, then follow the pilot runbook in
   [SMOKE_TESTS.md](SMOKE_TESTS.md#phone-verification-pilot-phase-15a4).

### Pre-flight isolation checks (all must be true before the first SMS)

- [ ] Staging site's `NEXT_PUBLIC_SUPABASE_URL` host differs from production's (compare the
      project refs; do this in the Vercel UI of each project, not from memory).
- [ ] The staging Vercel project is a different project from production, and the
      `SMSMESSENGER_*` / `SEND_SMS_HOOK_SECRET` / `PHONE_THROTTLE_HASH_SECRET` variables
      exist **only** there (check the production project and every Preview scope).
- [ ] Production: `PHONE_VERIFICATION_ENABLED` is unset, `SEND_SMS_HOOK_SECRET` and
      `SMSMESSENGER_*` are unset, and Supabase → Auth → Hooks → Send SMS is disabled
      (read-only check in the dashboard).
- [ ] Production migrations `20261016090000`/`20261016090100` are still unapplied
      (unless separately approved).
- [ ] Optional external proof the production endpoint cannot send: an **unsigned**
      `curl -i -X POST https://<production domain>/api/hooks/send-sms` must return
      `401` (secret configured) or `500` (secret absent) — never `200`. (Not run by
      this assistant: it would be a request against production.)
- [ ] Test numbers are internal SIMs you control, one per network.

### Safe observation of the hook payload

The hook deliberately logs nothing, so the real payload shape cannot be read
from Bambini's logs. Evidence available without code changes: TEST P8
(the text arrives at the **new** number) proves `sms.phone` is present and used
for `phone_change`, because the hook refuses to send without it. **Not
observable without a code change:** the contents of `sms.sms_type` and
`metadata` (and whether `metadata` carries an IP). If the team wants that,
the proposal is a temporary, staging-only diagnostic that logs **only key names
and value types** (never values), shipped on the `staging` branch and removed
afterwards — it needs separate approval; it is not part of this phase.

### Production activation remains a separate, later decision

Nothing in this section enables production SMS. After a PASS pilot, follow
"Connecting SMS" above for production.

## Known, deliberately out-of-scope gaps

Carried forward from Phase 15A/15B, not addressed here (see those
phases' reports for why): no clawback mechanism for a disputed order
that was already paid out; payout recovery can't detect a real-world
double-pay through an unobserved bank-side success; refunds are
schema-only; notification-producer failures are Postgres `WARNING`s
only, not Sentry-visible.
