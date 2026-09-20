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

## Listing / catalogue architecture (Phase 2A)

**Categories** are read fresh from the database on every request
(`src/server/categories/getCategories.ts`) and nested into a tree by a
pure function (`src/server/categories/tree.ts`) — the app has no
hard-coded category list anywhere; adding/renaming/reordering a
category is a data change, not a deploy.

**Listings** are `products` rows (see DATABASE.md for the schema/
ownership details); the application layer's job is enforcing the rules
RLS alone doesn't encode:

- `src/server/listings/validation.ts` — zod schemas for create/update,
  including a South African Rand → integer cents parser
  (`src/server/listings/price.ts`) that never does float arithmetic on
  the amount, and careful `null`/`undefined`/`""` normalization for
  every optional field (`FormData.get()` returns `null` for a missing
  field, which zod's own `.optional()` doesn't treat as absent the way
  a genuinely-missing object key does — handled with `z.preprocess()`).
- `src/server/listings/statusTransitions.ts` — the allowed
  draft/published/archived transition graph, a pure function so the
  same rule can gate a UI button (dimming "Publish" when it isn't a
  legal move) and the server action that actually performs it.
- `src/server/listings/actions.ts` — `createListing`, `updateListing`,
  `changeListingStatus`, `deleteListing`, `addListingImages`,
  `removeListingImage`. Every one calls `requireUser()` first and never
  reads a seller/owner id from the submitted form — for a business
  listing, `business_id` comes from the form (which business to list
  under), but RLS's own `is_business_member()` check on the `INSERT` is
  what actually authorizes it, not application code re-deriving
  membership; a denied insert surfaces as the same generic error as any
  other failure, deliberately not distinguishing "not a member" from
  other failures. `updateListing`/`changeListingStatus`/`deleteListing`
  treat "RLS filtered the row out" (0 rows affected/returned) and
  "doesn't exist" identically — "Listing not found" either way — so a
  stranger probing listing ids learns nothing. Publishing is blocked
  server-side if the listing has zero photos; deleting is blocked
  server-side unless the listing is still a draft (anything else must
  be archived) — both are application-level rules layered on top of
  RLS's ownership check, not replacements for it.

**Images** upload through the Server Action, not directly
browser-to-storage: the client submits `File` objects as part of the
same `FormData` the rest of the listing form uses, and the server
(using the *signed-in user's* Supabase client, so storage RLS still
applies — not the service-role client) validates each file's MIME
type and size (`src/server/listings/imageValidation.ts`, mirroring
`supabase/config.toml`'s bucket limits exactly) before uploading to
`storage.objects` at a `"<product_id>/<random>.<ext>"` path and
inserting the matching `product_images` row. Chosen over a client-side
upload flow to keep the "one form submission, one validated outcome"
mental model simple for this phase, at the cost of routing image bytes
through the Next.js server rather than straight to Storage — worth
revisiting if listings start carrying many/large images.

Displaying an image is the read side of the same private-bucket design:
`src/server/listings/imageUrls.ts` generates a short-lived signed URL
using the *viewer's* session, so a signed URL for a draft listing's
photo can only ever be minted for someone RLS already lets see that
listing — there is no stable public URL for any product image.

## Search / browse architecture (Phase 3A)

**Everything goes through one database function, not client-side
filtering.** `search_products()` (see DATABASE.md) is called via
`supabase.rpc()` from `src/server/search/searchListings.ts` — the
homepage's "recently listed" teaser, `/search`, and `/category/[slug]`
all call the exact same function with different arguments, rather than
each building its own query or (worse) fetching a broad set of listings
and filtering/sorting them in React. No page ever loads "the whole
catalogue" — every request is a single, already-paginated, already-
filtered round trip.

**Why a Postgres function rather than composing the query with
PostgREST filters in application code:** most of the individual filters
(`.eq()`, `.gte()`, `.lte()`) are already safe/parameterized either way.
The one that isn't straightforward is free-text search across two
columns (`title` OR `description`) — PostgREST's `.or()` method takes a
raw filter-string DSL where a user's own search term (containing a
comma, parenthesis, or period) can be misinterpreted as a DSL delimiter
rather than literal text. Hand-escaping that correctly for every case is
exactly the kind of thing worth avoiding rather than getting subtly
wrong once. A `plpgsql` function's parameters are genuine bound
variables regardless of what the caller puts in them — verified against
adversarial input (`term,with,commas`, `'; DROP TABLE products; --`,
etc.) in `tests/db/search.test.ts`, not assumed. This mirrors the
existing `search_nearby_products()` precedent from the foundation
phase.

**Sort is allowlisted twice.** `src/server/search/sort.ts` defines the
only values a client can ever select (`newest`, `price_asc`,
`price_desc`) and looks up a client-supplied value in that map — never
interpolates it into a query. `search_products()` normalizes its own
`sort_key` parameter against the same three values again, independently,
inside the function body (falling back to `newest`). Neither layer ever
lets a raw column name or SQL fragment reach an `ORDER BY`; the ordering
itself is built from `CASE WHEN normalized_sort = '...' THEN column
END` expressions, one per sort option, so exactly one is non-null for
any given request and the others are no-ops. Every sort ends in `id
desc` as a final tiebreaker, which is what keeps pagination
deterministic — two rows can share a price or a timestamp, but never an
id.

**Filters are validated and normalized server-side**
(`src/server/search/validation.ts`) before ever reaching
`search_products()`: an invalid/unparseable value (a mistyped price, an
unknown condition, a non-UUID category id) is silently dropped rather
than rejected, so a bookmarked or shared search URL degrades to "that
one filter didn't apply" instead of an error page. `sort` and `page`
are the exceptions — they always resolve to *something* valid (default
sort, clamped page number) since every search has to sort and paginate
by something.

**Category browsing resolves to leaf ids in application code, not
SQL.** A listing's `category_id` always points at a leaf category (the
create-listing form only ever offers leaves — see the Listing/catalogue
section above), so browsing a parent category like "Clothing" has to
match every one of its leaf descendants, not the literal "Clothing" id
(no listing is ever tagged with that). `src/server/categories/tree.ts`'s
`leafDescendantIds()` walks the already-fetched category tree to build
that list; `search_products()` just takes a flat `category_ids` array
and doesn't know or care about tree structure — category shape is
defined in exactly one place.

**Pagination is offset-based** (`page_size`/`page_offset`), computed
from a page number by `src/server/search/pagination.ts`, with the total
match count returned via a `count(*) over()` window function in the
same query as the page of results — one round trip, not a separate
`COUNT`. This is deliberately the simple choice for this phase's scale;
if the catalogue grows large enough that a high page number's `OFFSET`
becomes an expensive scan to skip past, cursor-based pagination (keyed
off the same `(sort column, id)` tiebreaker already used for
determinism) would be the natural next step — not needed yet.

**Images for a grid of results are fetched once, not per-card.** A
search results page collects every result's `cover_image_path` into one
array and calls `getSignedImageUrls()` (the same batched Storage call
Phase 2A's product/dashboard pages already use) a single time — never
one signed-URL request per card.

**Uncaught data-fetch failures now show a clean error state, not a
crash.** Adding search/browse pages surfaced a real gap: unlike the
site-wide header (which already degrades to "logged out" if Supabase is
unreachable — see Authentication architecture), `getCategoryTree()`
throws on failure, and nothing was catching that. A marketplace page
with no catalogue data to show doesn't have a meaningful degraded state
to fall back to, so the fix isn't to swallow the error — it's
`src/app/error.tsx`, Next.js's standard error-boundary convention,
which renders a branded "Something went wrong" message instead of the
framework's raw error overlay. Confirmed by deliberately breaking
Supabase connectivity in this environment and watching the page recover
cleanly instead of returning a 500.

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
