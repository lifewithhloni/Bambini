# Bambini — Database

PostgreSQL via Supabase, with PostGIS for location. Schema lives entirely
in version-controlled migrations under `supabase/migrations/`, applied in
filename order — see the end of this document for the local workflow.
For *why* RLS is structured the way it is, see
[ARCHITECTURE.md](ARCHITECTURE.md#authorization--rls-architecture); this
document focuses on schema shape and conventions.

## Conventions

- **Money is always an integer count of cents** (`*_cents`, `bigint`),
  never a float — avoids floating-point rounding bugs. `currency`
  defaults to `'ZAR'` but is a column, not assumed, on every monetary row.
- **Commission/rates are basis points** (`rate_bps`, `integer`, 0–10000),
  e.g. 1200 = 12%. Matches `calculateCommission()` in
  `src/server/commission/`.
- **Every table has RLS enabled in the same migration that creates it** —
  no gap where a table is briefly open.
- **`gen_random_uuid()`** (pgcrypto) for all primary keys.
- **Polymorphic seller/recipient pattern**: several tables (`products`,
  `orders`, `payouts`, `message_threads`, `reviews`,
  `seller_cash_status`) need to reference "either a parent profile or a
  business" as the seller/recipient. Rather than a nullable-FK-to-either
  free-for-all, each such table has a `seller_type` (or
  `recipient_type`) enum plus two nullable FK columns
  (`seller_profile_id`, `business_id`), enforced by a `CHECK` constraint
  that exactly one is set and it matches `seller_type`. This keeps
  referential integrity (a real FK, not an untyped UUID) while still
  letting one column tell you which kind of seller it is without a join.
- **Snapshot, don't recompute.** `orders.commission_rate_bps`,
  `orders.commission_amount_cents`, `order_items.price_cents_snapshot`,
  `promotions.price_cents_snapshot` all copy a value at the moment it was
  charged/applied. Rates and prices can change later; a historical order
  must not.

## Users and roles

`profiles` (1:1 with `auth.users`) has `role`: `parent` | `admin`.
**There is no `business` profile role.** A business storefront
(`businesses`) is owned by a profile (`owner_profile_id`) and is an
*additional* capability, not a replacement identity — this is what makes
"a parent can both buy and sell" (personally, as `seller_type = 'parent'`)
*and* run a verified storefront (as `seller_type = 'business'`) coherent
without the two conflicting. `business_members` lets an owner add staff
with dashboard access without transferring ownership.

`identity_verifications` (individual KYC, feeds cash eligibility) and
`business_verifications` (storefront verification) are separate tables
because they verify different things and have different reviewers/flows,
even though their shape is similar.

## Catalogue

`categories` is a self-referential tree (`parent_id`), seeded from the
initial taxonomy in `supabase/seed.sql` — the app never hard-codes a
category list. `products` references a single `category_id` (leaf
category); `product_images` and `product_favourites` hang off it.
`products.pickup_location_id` points at a `locations` row but — like
every other reference to `locations` — the row itself is never exposed
publicly; see the Nearby/location section of ARCHITECTURE.md.

## Commerce config

Three tables make rules that would otherwise be hard-coded into
admin-configurable data instead:

- `commission_rates` — append-only history of the parent/business
  commission percentage, so `orders.commission_rate_bps` can snapshot
  "the rate that applied when this order was placed" without ever being
  invalidated by a later rate change.
- `payment_providers` / `delivery_providers` — the DB-side registry
  mirroring `src/server/payments/registry.ts` and
  `src/server/delivery/registry.ts`; `is_active` and non-secret `config`
  live here, API keys live in environment variables only.
- `cash_eligibility_criteria` — the configurable rules
  `evaluateCashEligibility()` evaluates against a seller's standing.

## Orders, payments, commissions, payouts

**One order has exactly one seller.** A cart spanning multiple sellers is
split into one `orders` row per seller at checkout (collection/delivery
logistics and payout are inherently per-seller) — `order_items` can still
hold multiple line items *within* that seller's order.

`payments` is 1:1 with `orders`, including cash orders
(`method = 'cash'`, `provider_id null`) — a cash sale still gets a
payment record, per "every transaction has a record." `commissions` is a
1:1 append-only ledger mirroring the commission fields already snapshotted
on `orders`, kept as its own table so a future adjustment (e.g. a partial
refund changing what's actually owed) can be recorded as a new row rather
than mutating the original.

`payouts` aggregates money owed to a seller over a period;
`payout_items` is the join table recording exactly which orders made up a
given payout, so "why is this payout this amount" is always answerable.
`refunds` references both the order and the specific payment being
refunded.

## Delivery

`delivery_quotes` can exist before an order does (a buyer comparing
Cheapest/Standard/Express at checkout) — `order_id` is nullable and gets
attached once the buyer picks a quote and the order is created.
`delivery_orders` is the actual booked delivery, 1:1 with `orders`,
tracking `provider_tracking_ref` and a `delivery_order_status` that
mirrors what the provider reports (never inferred client-side).

## Cash collection

`collection_confirmations` (1:1 with an order using collection fulfilment)
holds the generated `collection_code` and who/when it was confirmed.
`seller_cash_status` is the current, server-computed cache of whether a
seller may offer cash — see
[ARCHITECTURE.md](ARCHITECTURE.md#cash-collection-architecture) for the
full flow and why new sellers default to `is_eligible = false`.

## Messaging, reviews, subscriptions, promotions

`message_threads` groups `messages` by (buyer, seller, optionally a
product). `reviews` is 1:1 with a completed `orders` row — one review per
transaction, left by the buyer. `subscriptions` models Parent+
(R59/month; a partial unique index enforces at most one `active`
subscription per profile), with `subscription_transactions` as its
billing history. `promotions` is a paid boost on a single product
(`boost_30`/`boost_60`/`boost_100`, R30/R60/R100, price snapshotted).

## Trust and safety

`reports` (user-submitted, against a product/profile/business/message/
review) and `disputes` (order-level, between buyer and seller) are
separate because they have different shapes and different resolution
flows, even though both ultimately get resolved by an admin.

## Audit trail

`transaction_events` (append-only, enforced by trigger in addition to
RLS) and `admin_actions` — see
[ARCHITECTURE.md](ARCHITECTURE.md#transaction-event--audit-system) for
what goes in each and why they're separate.

## Functions

- `is_admin()`, `is_business_member(business_id)` — RLS policy helpers.
- `search_nearby_products(...)`, view `product_locations_public` — the
  only sanctioned public reads of location data; see ARCHITECTURE.md.
- `handle_new_user()` — creates a `profiles` row on `auth.users` insert.
- `set_updated_at()` — generic `updated_at` maintenance trigger, applied
  to every table that has one.
- `apply_review_to_seller_rating()` — keeps `profiles`/`businesses`
  `rating_average`/`rating_count` in sync as a read-optimization cache;
  `reviews` remains the source of truth.
- `apply_order_completion_to_seller_stats()` — increments
  `completed_transaction_count` when an order's status transitions to
  `completed`, feeding the cash-eligibility criterion of the same name.

## Migration index

| File | Contents |
| --- | --- |
| `20260920090000_extensions_and_enums.sql` | `pgcrypto`, `postgis`, all enum types |
| `20260920090100_locations_and_profiles.sql` | `locations`, `profiles`, `identity_verifications` |
| `20260920090200_businesses.sql` | `businesses`, `business_members`, `business_verifications` |
| `20260920090300_categories_and_products.sql` | `categories`, `products`, `product_images`, `product_favourites` |
| `20260920090400_commerce_config.sql` | `commission_rates`, `payment_providers`, `delivery_providers`, `cash_eligibility_criteria` |
| `20260920090500_orders_payments.sql` | `orders`, `order_items`, `payments`, `commissions` |
| `20260920090600_payouts_and_refunds.sql` | `payouts`, `payout_items`, `refunds` |
| `20260920090700_delivery.sql` | `delivery_quotes`, `delivery_orders` |
| `20260920090800_cash_collection.sql` | `collection_confirmations`, `seller_cash_status` |
| `20260920090900_messaging_and_reviews.sql` | `message_threads`, `messages`, `reviews` |
| `20260920091000_subscriptions_and_promotions.sql` | `subscriptions`, `subscription_transactions`, `promotions` |
| `20260920091100_notifications_reports_disputes.sql` | `notifications`, `reports`, `disputes` |
| `20260920091200_transaction_events_and_admin_actions.sql` | `transaction_events` (+ append-only trigger), `admin_actions` |
| `20260920091300_functions_and_triggers.sql` | `updated_at` trigger, rating/stat aggregation, `search_nearby_products()` |
| `20260920091400_handle_new_user.sql` | Auto-create `profiles` on signup |
| `20260920091500_rls_policies.sql` | RLS enable + policies for every table, `is_admin()`/`is_business_member()`, public views |

## Local workflow

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and
Docker.

```bash
supabase start          # boots local Postgres + Auth + Storage + Studio
supabase db reset        # (re)applies all migrations + seed.sql
npm run db:types         # regenerates src/types/database.types.ts
```

A new migration: `supabase migration new <name>`, then edit the generated
file under `supabase/migrations/`. Never edit a migration that has already
been applied anywhere but local dev — add a new one instead.

**Still not done in this environment:** this machine has no Docker, so
`supabase start`/`supabase db reset` themselves have not been run here —
that's still the first thing to do in an environment that has Docker,
before building on top of this schema. What *has* been done instead (see
"Automated tests" below) is applying every migration and exercising the
RLS policies against a real Postgres + PostGIS engine via PGlite, which
caught and fixed one real gap (see [DECISIONS.md](DECISIONS.md)) before
any UI was built on top of it.

## Automated tests

`tests/db/` runs the actual migration SQL and the actual RLS policies
against a real Postgres engine — [PGlite](https://pglite.dev), Postgres
compiled to WASM, with a real PostGIS build — via `npm run test:db`
(kept separate from `npm run test`'s fast unit tests because booting a
fresh engine and applying every migration takes ~15-20s per test file,
~35-40s total).

- `tests/db/harness.ts` — boots PGlite, applies every migration +
  `seed.sql`, and provides `asUser()`/`asAnon()`/`asServiceRole()`
  helpers that switch to the real `authenticated`/`anon`/`service_role`
  Postgres roles and set the same `request.jwt.claim.sub` GUC
  PostgREST sets per request, so `auth.uid()` behaves exactly as it does
  against a live Supabase project.
- `tests/db/schema.test.ts` — table/view/FK/index existence, money
  columns are all `bigint`, the `seller_type` XOR pattern holds on every
  polymorphic table, RLS is enabled everywhere it should be,
  `search_nearby_products()` returns correct real distances, and
  `transaction_events` genuinely rejects `UPDATE`/`DELETE`.
- `tests/db/rls.test.ts` — the security checklist: anonymous access to
  private tables, cross-user profile/order/product mutation, commission/
  payment/payout/transaction-event forgery, cash-collection-confirmation
  forgery, whether exact coordinates ever leak through
  `product_locations_public` or `search_nearby_products()`, and that only
  `service_role` (never `authenticated`) can perform the writes the
  architecture reserves for server-side code.

**Limitations of this approach**, so results aren't over-trusted: PGlite
is a real Postgres engine, but this is not the full Supabase platform —
there's no real GoTrue, PostgREST, or Storage, and `auth.users`/
`auth.uid()` are a small hand-built stand-in for what Supabase actually
provisions (matched to the columns our migrations actually touch, e.g.
`raw_user_meta_data`). A clean `tests/db` run is strong evidence the
schema and RLS policies are internally consistent; it is not a
substitute for running the real Supabase CLI + Docker stack at least
once before production.
