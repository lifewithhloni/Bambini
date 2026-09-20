# Bambini — Architecture

Bambini is a South African marketplace for parents to buy and sell baby/kids
products, with parent-to-parent and verified-business selling, free
collection, dynamically priced delivery, controlled cash collection, and a
commission-based business model. This document describes the technical
architecture established in the foundation phase. It intentionally does not
describe marketplace *features* in detail — see [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
for what gets built when, and [DATABASE.md](DATABASE.md) for the schema.

## Principles

These carry through every architectural choice below:

- **Business rules are enforced server-side, never trusted from the client.**
  Commission, order totals, payouts, cash eligibility, and delivery status
  are always computed or verified in server code (Route Handlers, Server
  Actions, or the service-role client), never accepted as-is from a request
  body.
- **Every transaction has a record.** Beyond normal relational rows, a
  parallel append-only audit log (`transaction_events`) captures what
  happened, who did it, and when — for online payments, cash collection,
  delivery, cancellations, refunds, disputes, and commission.
- **External integrations are replaceable.** Payment and delivery providers
  are accessed through an interface, never called directly from application
  code, so a new provider is an adapter + a config change, not a rewrite.
- **Nothing exposes a secret or an exact address.** Payment/delivery API
  keys live only in environment variables. Seller/buyer precise
  coordinates never reach the client — only a rounded distance or
  suburb/city.

## Tech stack

Next.js (App Router) + TypeScript (strict) + Tailwind CSS, PostgreSQL via
Supabase (Auth, Database, Storage, RLS), deployed on Vercel. See
[ENVIRONMENT.md](ENVIRONMENT.md) for configuration and
[DECISIONS.md](DECISIONS.md) for why this stack.

## Project structure

```
src/
  app/                  Next.js routes (App Router). UI only — no business logic.
  components/           Shared UI components (added as real screens are built).
  config/
    env.ts              Typed, validated environment access (zod). Import this,
                         never process.env directly, in server code.
  lib/
    supabase/
      client.ts         Browser Supabase client (anon key, RLS applies).
      server.ts         Server Component / Route Handler client (anon key, RLS applies).
      admin.ts           Service-role client. Bypasses RLS — server-only, used only
                         after application code has already authorized the action.
      middleware.ts      Session-refresh helper used by src/middleware.ts.
    geo.ts               Pure geo math (haversine) shared by the mock delivery
                         provider and tests.
  server/                Business logic, isolated from UI (rule 5: "keep business
                         logic separate from UI").
    commission/          Commission calculation — pure, unit-tested.
    cash-eligibility/    Cash-collection eligibility rules engine — pure, unit-tested.
    delivery/            Delivery-provider abstraction (types, registry, adapters).
    payments/            Payment-provider abstraction (types, registry, adapters).
  types/
    database.types.ts    Generated from the live schema via `npm run db:types`.
supabase/
  config.toml            Local Supabase stack configuration.
  migrations/             Version-controlled schema, in order. See DATABASE.md.
  seed.sql                Local dev seed data (categories, default config).
```

## Authentication architecture

Supabase Auth issues a JWT per signed-in user, stored in cookies via
`@supabase/ssr`. Three client factories exist because Next.js code runs in
three different contexts with different privileges:

- `lib/supabase/client.ts` — browser (Client Components). Runs as the
  signed-in user; every query is subject to RLS.
- `lib/supabase/server.ts` — server (Server Components, Route Handlers,
  Server Actions). Also runs as the signed-in user (anon key + the user's
  JWT from cookies) — RLS still applies. This is the client almost all
  server code should use.
- `lib/supabase/admin.ts` — service-role key, **bypasses RLS entirely**.
  Guarded by the `server-only` package so importing it from client code is
  a build error. Reserved for operations application code has already
  authorized (e.g. recording a payout, writing a `transaction_event`).

`src/proxy.ts` (Next.js 16's renamed `middleware.ts` convention) refreshes
the auth cookie on every request via `updateSession()`, because Server
Components cannot write cookies themselves — without it, sessions would
silently expire instead of refreshing.

A `public.profiles` row is created automatically for every new
`auth.users` row via a database trigger (`handle_new_user`), so the app
never has to remember a "create profile after signup" step, and a user id
is guaranteed to have exactly one profile from the moment they exist.

Roles: `profiles.role` is `parent` or `admin`. **`business` is not a
profile role** — it's a capability a profile can additionally hold by
owning a row in `businesses` (see [DATABASE.md](DATABASE.md#users-and-roles)
for why). This lets one person buy and sell as a parent *and* run a
storefront, matching "a parent can both buy and sell."

### Phase 1 implementation

- **Pages**: `/signup`, `/login` (Client Components — forms need
  `useActionState` for pending/error UI), `/account` (Server Component,
  protected, `export const dynamic = "force-dynamic"` since it's
  per-user data that must never be statically cached).
- **Server Actions** (`src/server/auth/actions.ts`): `signUp`, `signIn`,
  `signOut`. Every field comes from the submitted form and is validated
  with zod (`src/server/auth/validation.ts`) before ever reaching
  Supabase; there is no user-id field anywhere in the sign-up/sign-in
  input — Supabase Auth derives the id, and `handle_new_user()` creates
  the matching profile row in the same transaction, so there's no
  client-supplied id for anything to trust. `signIn` returns a generic
  "Incorrect email or password" on failure regardless of which part was
  wrong, so the endpoint can't be used to enumerate registered emails.
- **Protected routes**: `requireUser()` (`src/server/auth/requireUser.ts`)
  is the authoritative gate — it re-verifies via `getUser()` (not
  `getSession()`, which only decodes the local cookie without checking
  it's still valid) and `redirect()`s to `/login?next=<path>` if there's
  no session. It is called from the protected page itself, not relied on
  via `proxy.ts` alone: per Supabase's current guidance, middleware
  should refresh the session, not be the sole authorization gate, so a
  misconfigured matcher can't silently leave a route unprotected.
  `getOptionalUser()` is the sibling for UI that must never fail the page
  it's on (the site header, which renders on every route including
  statically-generated public ones) — it degrades to "logged out" rather
  than throwing if Supabase is unreachable or unconfigured.
- **Post-login redirect** (`next=`) is validated by `safeRedirectPath()`
  to only ever accept a same-origin relative path, guarding against an
  open-redirect (`?next=https://evil.example.com` falls back to
  `/account`, not the attacker's URL).
- **Profile editing** (`src/app/account/actions.ts`): scoped to
  `requireUser()`'s verified id, never a value from the form — but the
  real enforcement is the database's RLS policy plus the column-level
  `GRANT` restricting which columns are writable at all (see below), so
  the query being correctly scoped in application code is defense in
  depth, not the security boundary itself.

## Authorization / RLS architecture

Every table has Row Level Security enabled from its first migration —
there is no window where a table exists without RLS. Two different
strategies are used, deliberately:

1. **Content tables** (`profiles`, `businesses`, `products`, `messages`,
   `reviews`, `categories`, ...) — direct client reads/writes through RLS
   policies are the normal path, scoped to the owning user/business, or
   public where the product intentionally makes something public (active
   listings, reviews, categories). Column-level grants add defense in
   depth on top of row-level policies: e.g. a user can `UPDATE` their own
   `profiles` row per RLS, but a column-level `REVOKE`/`GRANT` means only
   `full_name`, `avatar_url`, `phone`, `location_id` are actually
   writable — `role`, `account_verification`, `rating_average`, etc. are
   not, even though the row-level policy would otherwise allow the
   statement to reach the row.

2. **Money-moving / state-machine tables** (`orders`, `payments`,
   `commissions`, `payouts`, `refunds`, `delivery_quotes`,
   `delivery_orders`, `collection_confirmations`, `seller_cash_status`,
   `subscriptions`, `promotions`, `transaction_events`,
   `commission_rates`) — users get **SELECT-only** policies scoped to
   rows they're a party to. There is deliberately no
   `INSERT`/`UPDATE`/`DELETE` policy for the `authenticated` role on
   these tables at all. Every write happens server-side through the
   service-role client, only after application code has validated the
   relevant business rule (commission math, cash eligibility, a legal
   order-status transition, who's allowed to trigger it). This was chosen
   over encoding a full order state machine in RLS policies, which is
   possible but becomes hard to audit and easy to get subtly wrong as
   states multiply — see [DECISIONS.md](DECISIONS.md).

`transaction_events` additionally blocks `UPDATE`/`DELETE` with a
database trigger, not just RLS — because the service-role key bypasses
RLS by design, RLS alone isn't a strong enough guarantee that the audit
log stays append-only; the trigger is.

Two SQL helper functions, `is_admin()` and `is_business_member(business_id)`,
centralize the two most common authorization checks so policies stay
short and consistent rather than each re-deriving them.

**Sensitive raw tables are never selectable by arbitrary users.** In
particular `locations` (precise coordinates + formatted address) has no
public SELECT policy at all — see "Nearby / location privacy" below for
how public reads happen instead.

## Payment architecture

`src/server/payments/types.ts` defines a `PaymentProvider` interface:
`createCheckout`, `verifyWebhook`, `refund`. Nothing outside
`src/server/payments/` should import a provider SDK directly.
`src/server/payments/registry.ts` selects the active adapter from the
`PAYMENT_PROVIDER` env var (`mock` by default — no keys needed for local
dev). Adding PayFast, Yoco, or Stripe is: write an adapter implementing
`PaymentProvider`, register it in the factory map, set
`PAYMENT_PROVIDER` — no checkout/order code changes.

The provider only *moves money and reports status*. It never decides an
amount: order totals and commission are always computed server-side from
trusted DB state (product price, delivery quote, `commission_rates`)
before `createCheckout` is ever called, and a webhook's reported amount
is checked against the order's stored `total_cents`, not trusted blindly.

## Delivery-provider abstraction

Mirrors the payment abstraction, with one difference: checkout typically
wants quotes from *every* active provider at once (to build "Cheapest /
Standard / Express"), not just one. `src/server/delivery/types.ts` defines
`DeliveryProvider`: `getQuotes`, `bookDelivery`, `getStatus`.
`src/server/delivery/registry.ts` reads `DELIVERY_PROVIDERS` (a
comma-separated list) and fetches quotes from all of them in parallel via
`getAllDeliveryQuotes()`. Adding Uber Direct, Courier Guy, or Bob Go is
the same shape as payments: an adapter + a registry entry + config.

Per the product brief, sellers never enter weight or package dimensions —
`DeliveryQuoteRequest` only carries pickup/dropoff coordinates and an
optional category slug; a provider adapter that needs a size estimate
derives it internally (e.g. from category) rather than the marketplace
collecting it.

## Transaction event / audit system

`transaction_events` is the marketplace's audit trail, separate from (not
instead of) the normal relational tables. Every event that matters
financially or operationally — order created, payment authorized/paid,
collection code confirmed, commission recorded, delivery status changed,
refund processed, dispute opened — gets a row: `entity_type` +
`entity_id` point at what the event is about, `order_id` is denormalized
onto every row so "show me everything that happened on this order" is one
indexed query, `actor_type`/`actor_id` record who or what triggered it
(`system`, `buyer`, `seller`, `admin`, `delivery_provider`,
`payment_provider`), and `payload` carries event-specific detail as
JSON. The table is append-only, enforced by both RLS (no write policy for
regular users) and a trigger (blocks `UPDATE`/`DELETE` even for the
service role).

`admin_actions` is a second, narrower audit table specifically for
platform-staff actions (approving a verification, resolving a dispute,
suspending an account) — kept distinct from `transaction_events` because
it's about staff behavior, not order/financial lifecycle.

## Cash collection architecture

Cash is supported **only** for collection, and new sellers do **not**
get it automatically. The flow, matching the product brief exactly:

1. Buyer selects "Cash at Collection" at checkout — only offered if the
   seller currently passes eligibility (see below).
2. An `orders` row is created with `payment_method = 'cash'`,
   `fulfilment_type = 'collection'`.
3. A `payments` row is created with `method = 'cash'`, `status =
   'pending'` — a cash order gets a payment record just like an online
   one; "every transaction has a record" applies here too.
4. A `collection_confirmations` row is created with a generated
   `collection_code`.
5. Buyer pays the seller cash in person; the seller enters the code in
   the app.
6. Confirming the code — server-side, not trusted from either party's
   unverified say-so — sets `collection_confirmations.confirmed_at`,
   flips `payments.status` to `paid`, `orders.status` to `completed`, and
   the existing commission snapshot on the order (12% parent / 15%
   business, computed at order creation by `calculateCommission()`)
   remains payable exactly as for an online payment.
7. Every step above also writes a `transaction_events` row.

**Eligibility** is evaluated by
`src/server/cash-eligibility/evaluateCashEligibility.ts`, a pure,
unit-tested function that takes a trusted `SellerStanding` snapshot
(gathered server-side — never from the client) and a list of
admin-configurable criteria from the `cash_eligibility_criteria` table
(minimum completed transactions, minimum rating, requires account
verification, requires identity verification, maximum unresolved
disputes; bad account standing short-circuits to ineligible regardless of
the rest). The result is cached per seller in `seller_cash_status`
(`is_eligible` defaults to `false`), recomputed when something that
could change it happens (a verification completes, an order completes, a
dispute resolves). Checkout only shows "Cash at Collection" when
`seller_cash_status.is_eligible = true` for that seller, checked
server-side at the time of purchase, not just at page-render time.

## Nearby / location privacy

A seller's exact residential/pickup address is never sent to the client
in a public context. `locations` (precise `latitude`/`longitude`,
`formatted_address`) has no public SELECT policy — full rows are only
visible to their owner and admins. Public reads go through two
sanctioned, narrow surfaces instead:

- `search_nearby_products(buyer_lat, buyer_lng, radius_km,
  category_filter)` — a `SECURITY DEFINER` SQL function that does the
  PostGIS distance computation server-side and returns only a rounded
  `distance_km` (one decimal place) plus `suburb`/`city`, never raw
  coordinates. This is the only path "Nearby" browsing uses.
- `product_locations_public` — a view exposing `suburb`/`city`/`province`
  for a single active product's pickup point, for the product detail
  page, again never raw coordinates or the formatted address.

Both are `SECURITY DEFINER` (equivalently, views declared
`security_invoker = false`), so they can read the locked-down
`locations` table on the caller's behalf — but because they're
hand-written to select only the safe columns/derived values, they can't
leak more than that regardless of who calls them. The same pattern
(`profiles_public`, `businesses_public`) hides other sensitive columns
(e.g. a business's registration/VAT numbers) behind a curated public
view rather than ever opening the raw table to `anon`/`authenticated`.

## Technical risks

- **RLS policies are a first pass.** They're structured and consistent,
  but a schema this size needs a dedicated security review (and ideally
  policy tests) before handling real money — see
  [DECISIONS.md](DECISIONS.md).
- **No real payment or delivery provider is integrated yet** — only the
  interfaces and a mock adapter. PayFast/Yoco/Stripe and
  Uber Direct/Courier Guy/Bob Go each have their own quirks (webhook
  signature schemes, idempotency, rate limits) that the abstraction is
  designed to absorb but hasn't been proven against a real provider yet.
- **PostGIS/`geography` at scale.** The `search_nearby_products` function
  and the `geo` GiST index should comfortably handle the marketplace's
  initial scale, but haven't been load-tested.
- **Money as integer cents** avoids float rounding bugs but every new
  piece of code that touches an amount must remember the convention (see
  [DECISIONS.md](DECISIONS.md)); a currency-safe value type is worth
  considering if this becomes error-prone in practice.
- **Migrations haven't been run against a live Postgres instance in this
  environment** (no Docker available here to run `supabase start`) — they
  were written carefully and reviewed for syntax/dependency-order
  correctness, but should be applied to a real local Supabase stack and
  smoke-tested before being treated as final. See
  [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Open decisions

See [DECISIONS.md](DECISIONS.md) for architectural decisions already made
(with rationale) and the list of decisions that need product/stakeholder
input before the next phase.
