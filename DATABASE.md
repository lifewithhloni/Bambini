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
category list; `src/server/categories/getCategories.ts` reads it fresh
and `src/server/categories/tree.ts` nests it into a tree/leaf-option
list purely in application code. `products` references a single
`category_id` (leaf category); `product_images` and
`product_favourites` hang off it. `products.pickup_location_id` points
at a `locations` row but — like every other reference to `locations` —
the row itself is never exposed publicly; see the Nearby/location
section of ARCHITECTURE.md. Phase 2A left it null for every listing
(there was no location picker yet); Phase 3B sets it automatically
(`resolveOwnPickupLocationId()` in `src/server/listings/actions.ts`) to
the seller's own saved location whenever a listing offers collection —
see "Nearby / location (Phase 3B)" below.

### Listing lifecycle (Phase 2A)

`product_status` is `draft` | `published` | `archived` — deliberately
no order-related state (a listing becoming unavailable because it sold
is Phase 4's concern, not the listing's own lifecycle). The foundation
phase's enum had `active`/`sold`/`removed` instead;
`20260921090000_align_listing_labels.sql` renames `active` to
`published` (`sold`/`removed` are left as inert, unused labels — see
DECISIONS.md for why removing them outright wasn't worth the risk).
`product_condition` is `like_new` | `excellent` | `good` | `fair`
(renamed from `new`/`like_new`/`good`/`fair` in the same migration).
Allowed transitions are enforced in application code
(`src/server/listings/statusTransitions.ts`), not the database: `draft`
→ `published`/`archived`, `published` → `draft`/`archived`, `archived`
→ `draft` only (re-publishing from archived must go through draft
first). Publishing additionally requires at least one `product_images`
row — enforced in `src/server/listings/actions.ts`, not RLS.

### Listing ownership

Unchanged pattern from the foundation phase (`seller_type` +
`seller_profile_id`/`business_id`, see "Users and roles" above) — Phase
2A's contribution is closing a gap the RLS policies for `products` had:
`products_update_owner_or_admin` now carries an explicit `WITH CHECK`
(`20260921090100_harden_listing_ownership.sql`) so a seller can't
reassign a listing's `seller_profile_id`/`business_id` via `UPDATE`,
verified against a real engine — Postgres actually already enforced
this implicitly (an `UPDATE` policy with no `WITH CHECK` defaults to
its `USING` clause), but making it explicit means a future reader
doesn't have to know that. A business member (owner or anyone in
`business_members`) can manage that business's listings exactly like an
owner — see `is_business_member()`.

### Product images and storage

`product_images.storage_path` must start with `"<its own product_id>/"`
— enforced by a `CHECK` constraint
(`product_images_storage_path_matches_product`), not just RLS, so a
listing's image rows can only ever reference files under its own
storage folder, never another product's (even one the same seller
owns). The `product-images` Supabase Storage bucket is **private**
(`supabase/config.toml`, changed from public in the foundation phase) —
a public bucket serves files from an endpoint that bypasses RLS
entirely, which can't keep a draft listing's photos unlisted. Instead,
`storage.objects` gets its own RLS policies
(`20260921090200_product_images_storage_policies.sql`) mirroring the
`products` table's own visibility rule exactly: upload/delete are
owner-or-business-member-or-admin only (checked by extracting the
leading `<product_id>/` path segment and joining back to `products`),
and read follows `products.status = 'published' OR owner/member/admin`
— so a stranger's browser can view a published listing's photos (via a
signed URL, see ARCHITECTURE.md) but never a draft's.

### Search and browse (Phase 3A)

`search_products()` (`20260922090000_search_products.sql`) is the single
entry point every browse/search/category page goes through — see
ARCHITECTURE.md for the full rationale. It is **not** `SECURITY
DEFINER`: it runs as the calling role (`anon`/`authenticated`), so it's
subject to the same `products`/`product_images` RLS as any other query;
its own explicit `status = 'published'` filter is defense in depth
alongside RLS, the same pattern `getPublicListing()` already used in
Phase 2A. `tests/db/search.test.ts` proves this empirically — a
`prosecdef` check confirms the function isn't a definer, and confirms
`total_count` and every result row only ever reflect published listings
regardless of who's calling it, including the listing's own owner.

Every filter parameter is a genuine bound `plpgsql` parameter, and
`sort_key` is normalized against an explicit allowlist inside the
function body (falls back to `'newest'` for anything else) — verified
against adversarial input (SQL comment sequences, PostgREST-DSL special
characters) in both `tests/db/search.test.ts` and
`src/server/search/sort.test.ts`. Pagination is offset-based
(`page_size`/`page_offset`, both clamped server-side) with a `count(*)
over()` window function returning the total match count in the same
query — one round trip instead of a separate `COUNT` query. Ordering
always ends in `id desc` as a final tiebreaker, so two rows with the
same price or timestamp never produce unstable/duplicated pages.

New indexes, added because the two sort dimensions this phase
introduces (`newest`, `price_asc`/`price_desc`) both filter by `status`
*and* sort by one other column — a composite index serves filter+sort
in one pass where the existing single-column `products_status_idx`
would still need a separate sort step:

- `products_status_created_at_idx (status, created_at desc)` — the
  default "newest published" browse query.
- `products_status_price_idx (status, price_cents)` — price-sorted
  browse (btree scans either direction, so this covers both
  `price_asc` and `price_desc`).
- `products_title_trgm_idx` — a `pg_trgm` GIN index on `title`, since a
  leading-wildcard `ILIKE '%term%'` (what free-text search needs) can't
  use an ordinary btree index at all. Description search still works
  (`title ILIKE ... OR description ILIKE ...`) but falls back to a
  sequential scan for now — only `title` got a dedicated index; see
  DECISIONS.md for why.

No new index was added for `category_id` + status/sort combinations —
the existing single-column `products_category_id_idx` is judged
sufficient at this phase's data volume; see DECISIONS.md if that needs
revisiting later.

### Nearby / location (Phase 3B)

`locations` (`created_by`, `latitude`/`longitude`, a generated
`geo geography(point,4326)` column, `suburb`/`city`/`province`/
`postal_code`/`formatted_address`) and its GiST index
(`locations_geo_idx`) both date to the foundation phase and are
unchanged this phase — inspected first, per the "don't blindly replace
existing location infrastructure" rule, and found already sufficient.
What Phase 3B actually adds:

- **`search_nearby_products()` extended in place**
  (`20260923090000_nearby_search.sql`, `DROP FUNCTION` + `CREATE
  FUNCTION` — a `RETURNS TABLE` function's output columns can't be
  changed by `CREATE OR REPLACE`, only its body, verified against a real
  engine before finalizing this). New signature: `category_filter uuid`
  becomes `category_ids uuid[]` (matching `search_products()`'s resolved-
  leaf-ids convention); adds `min_price_cents`, `max_price_cents`,
  `condition_filter`, `collection_only`, `delivery_only`, `sort_key`
  (`distance` default, plus `newest`/`price_asc`/`price_desc`),
  `page_size`, `page_offset`. Returned columns drop `seller_type`,
  `seller_profile_id`, `business_id` (never on the documented minimal
  public field list this phase requires, and nothing in the app needs
  them for a Nearby card) and add `collection_available`,
  `delivery_available`, `created_at`, `cover_image_path`, `distance_km`,
  `suburb`, `city`, `total_count` — the same fields `search_products()`
  already returns, plus `distance_km`/`suburb`/`city`. Still `SECURITY
  DEFINER`, for the reason explained in ARCHITECTURE.md (callers have no
  SELECT grant on `locations` at all). `radius_km` is clamped to
  `{5, 10, 25, 50}` inside the function (falls back to `10`) — an
  arbitrary client-supplied radius is never honored verbatim.
- **`products_pickup_location_id_idx`** — the one join in this query
  (`locations` → `products` on `pickup_location_id`) that had no
  supporting index; every other FK `products` is commonly joined through
  already had one (see the Search/browse section above).
- **Ownership hardening on `products.pickup_location_id`** —
  `products_insert_owner` and `products_update_owner_or_admin` are
  redefined (`DROP POLICY` + `CREATE POLICY`, since a `WITH CHECK`
  expression can't be altered in place) adding: `pickup_location_id is
  null or exists (select 1 from locations l where l.id =
  pickup_location_id and l.created_by = auth.uid())`, admin-exempted on
  UPDATE. Closes a real gap — until this migration, neither policy
  constrained *which* location a listing could reference, only that the
  listing itself belonged to the caller.

`tests/db/nearby.test.ts` covers all of this against a real
Postgres/PostGIS engine: the phase's 12 required privacy tests
(anonymous/authenticated coordinate access, public-query column
shape, cross-seller location-attachment/mutation/retrieval attempts,
RPC-parameter tampering, unpublished/archived exclusion), plus radius
boundaries, distance sorting, the preserved `search_products()` filters,
and pagination.

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

### Checkout and order creation (Phase 4A)

Every table above existed unused since the foundation phase — this
phase's actual work was the creation path, not new tables. One addition:
`orders.order_reference` (`20260925090000_orders_checkout.sql`), a
public-safe `BMB-XXXXXX` reference filled by a column `DEFAULT`
(`'BMB-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))`),
not application code — every future `INSERT` gets one automatically,
including the raw fixture `INSERT` in `tests/db/rls.test.ts`, which
predates this column and never mentions it.

**`create_order(p_product_id, p_fulfilment_type)`** is the single,
`SECURITY DEFINER` entry point for placing an order — one
`plpgsql` function body is one transaction, which is what makes the six
things a purchase touches (flip the product to `sold`, insert the
order/order_item/payment/commission, insert an `order.created`
`transaction_events` row) all succeed or all fail together. It's
`SECURITY DEFINER` for a concrete reason: none of
`orders`/`order_items`/`payments`/`commissions`/`transaction_events` has
an `INSERT` policy for `authenticated` at all (server-side-only writes,
by design since the foundation phase's own RLS migration), and a buyer
has no ownership-based `UPDATE` grant on a product they don't own.
Every value it writes — buyer (`auth.uid()`), seller (loaded from the
product row), commission rate (the latest `commission_rates` row for
that `seller_type`), price (the product's own `price_cents`) — is
derived inside the function body, never accepted as a parameter.
`EXECUTE` is revoked from `PUBLIC` and `anon`, granted only to
`authenticated` (see the Phase 3B security review's identical finding
for `search_nearby_products()` — `CREATE FUNCTION` grants `EXECUTE` to
`PUBLIC` by default unless revoked).

**Overselling and duplicate-submission protection are the same
mechanism**: `update products set status = 'sold' where id = ... and
status = 'published'`. The foundation phase's `product_status` enum
already had an unused `sold` label (see
`src/server/listings/statusTransitions.ts`'s own comment anticipating
exactly this) — no new enum value was needed. Postgres locks the row
for the UPDATE's duration; a second concurrent or retried request for
the same listing re-evaluates the `WHERE` clause against the first
request's now-committed `'sold'` status and matches zero rows, so
`create_order()` raises a clean "not available" error rather than
creating a second successful order. `tests/db/orders.test.ts` proves
this with a real concurrent-request test (`Promise.allSettled` on two
simultaneous calls), not just by reasoning about how `UPDATE ... WHERE`
row locking works.

### Online payments (Phase 4B)

One new column, one new index, two new functions
(`20260926090000_payfast_payment_integration.sql`), and one changed
line in `create_order()` — the `orders`/`order_items`/`payments`/
`commissions`/`transaction_events` tables themselves are untouched.

- **`payment_providers`** gets a seeded `payfast` row, `is_active =
  false` by default — a fresh/test database keeps behaving exactly as
  Phase 4A did (every order attaches to `mock`) until an operator
  explicitly flips this (together with `PAYMENT_PROVIDER=payfast` — see
  ENVIRONMENT.md for why both have to change together).
- **`payments_provider_reference_idx`** — a partial unique index on
  `payments.provider_reference` (`WHERE provider_reference IS NOT
  NULL`). Defense-in-depth against two different orders' payments rows
  ever ending up with the same provider reference; the payment
  lifecycle itself can't produce a second `payments` row per order
  regardless, since `payments.order_id` was already unique.
- **`create_order()`** (Phase 4A, redefined via `CREATE OR REPLACE` —
  same signature, same return columns, so no `DROP` was needed): the
  payment-provider lookup changed from a hardcoded `slug = 'mock'` to
  `WHERE is_active LIMIT 1`, so a real order actually attaches to
  whichever provider is genuinely configured, not permanently pinned to
  the mock adapter. Nothing else in the function changed.
- **`record_payment_attempt(p_order_id, p_provider_reference)`** —
  `SECURITY DEFINER`, the payment-initiation write. Same justification
  as `create_order()`: no `UPDATE` policy exists on `payments` for
  `authenticated`, so a buyer paying for their own order still needs an
  elevated, narrowly-scoped path. Re-validates ownership
  (`auth.uid() = orders.buyer_id`), order status
  (`pending_payment`), and payment status (`pending` or `failed` —
  never a completed payment) from scratch every call; sets
  `payments.status = 'pending'` and the new `provider_reference`, and
  records a `payment.initiated` transaction event. `EXECUTE` restricted
  to `authenticated`.
- **`process_payfast_itn(p_order_id, p_provider_reference, p_status,
  p_amount_cents)`** — the webhook's atomic state-mutation function,
  called only by the webhook route via the service-role client, only
  after that route has independently verified the PayFast signature,
  host, and `/eng/query/validate` confirmation. Deliberately *not*
  `SECURITY DEFINER` — its only legitimate caller (`service_role`)
  already bypasses RLS regardless of the function's own security mode,
  so `SECURITY DEFINER` would add no real privilege boundary here
  (contrast `create_order()`/`record_payment_attempt()`, whose caller
  is an ordinary `authenticated` user with none). `EXECUTE` is revoked
  from `PUBLIC`/`anon`/`authenticated` and granted only to
  `service_role` — *that* grant restriction is the actual protection
  against a normal user calling this to fake a payment confirmation.
  Independently re-verifies the reported amount against
  `orders.total_cents` (Bambini's own authoritative value, checked
  again here rather than trusted a second time from the caller) before
  changing anything. Idempotent and state-machine-safe: a payment
  already `paid` is never touched by any later event regardless of what
  it claims (`tests/db/payfast.test.ts` proves this can't be downgraded
  to either `pending` or `failed`); an exact repeat of an
  already-recorded `failed` outcome for the same provider reference is
  a no-op, not a second `transaction_events` row. A genuine retry
  succeeding after a real failure (`failed` → `paid`, a *different*
  provider reference) is allowed — see DECISIONS.md for why that's a
  deliberate design choice, not an oversight. On success: `payments`
  moves to `paid`/`failed`; `orders` moves `pending_payment` →
  `confirmed` only for the `paid` case (the existing `order_status`
  enum's own state for "payment succeeded," not a new value — see
  DECISIONS.md); a `payment.confirmed`/`payment.failed`
  `transaction_events` row is inserted; commission is never touched;
  the product's `sold` status is never reverted.

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
- `search_products(...)` — the single entry point for ordinary browse/
  search (Phase 3A); not `SECURITY DEFINER`. See ARCHITECTURE.md.
- `search_nearby_products(...)`, view `product_locations_public` — the
  only sanctioned public reads of location data; both `SECURITY
  DEFINER`. See ARCHITECTURE.md.
- `create_order(p_product_id, p_fulfilment_type)` (Phase 4A) — the sole
  entry point for placing an order; `SECURITY DEFINER` because no
  INSERT policy exists on orders/payments/commissions/transaction_events
  for `authenticated`. See ARCHITECTURE.md and the migration's own
  comment.
- `record_payment_attempt(p_order_id, p_provider_reference)` (Phase 4B)
  — `SECURITY DEFINER`, same reasoning as `create_order()`; the
  payment-initiation write. `EXECUTE`: `authenticated` only.
- `process_payfast_itn(p_order_id, p_provider_reference, p_status,
  p_amount_cents)` (Phase 4B) — NOT `SECURITY DEFINER` (its only caller,
  `service_role`, already bypasses RLS); `EXECUTE`: `service_role` only.
  See ARCHITECTURE.md.
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
| `20260920100000_restrict_insert_columns.sql` | Column-level INSERT grants on `profiles`/`businesses`/`business_verifications`/`identity_verifications` — closes a self-verification gap found in Phase 1, see DECISIONS.md |
| `20260921090000_align_listing_labels.sql` | Renames `product_condition`/`product_status` enum labels to the agreed listing model; redefines `search_nearby_products()` for the renamed status |
| `20260921090100_harden_listing_ownership.sql` | Explicit `WITH CHECK` on the `products` UPDATE policy; `product_images.storage_path` ↔ `product_id` binding constraint |
| `20260921090200_product_images_storage_policies.sql` | RLS on `storage.objects` for the `product-images` bucket (upload/read/delete) |
| `20260922090000_search_products.sql` | `pg_trgm` extension + 3 new indexes; `search_products()` — the safe, parameterized, allowlisted-sort search/browse/filter/paginate entry point |
| `20260923090000_nearby_search.sql` | `search_nearby_products()` extended (filters, pagination, distance/newest/price sort) via DROP + CREATE; `products_pickup_location_id_idx`; ownership `WITH CHECK` hardening on `products_insert_owner`/`products_update_owner_or_admin` for `pickup_location_id` |
| `20260924090000_location_ownership_review_fixes.sql` | Security review follow-up: same ownership `WITH CHECK` extended to `profiles_insert_own`/`profiles_update_own_or_admin` for `location_id`; `search_nearby_products()`'s `EXECUTE` grant tightened to exclude the default `PUBLIC` grant |
| `20260925090000_orders_checkout.sql` | `orders.order_reference` column (+ default generator); `create_order()` — the `SECURITY DEFINER`, atomic order-creation entry point |
| `20260926090000_payfast_payment_integration.sql` | Seeded `payfast` `payment_providers` row (inactive by default); partial unique index on `payments.provider_reference`; `create_order()` provider lookup fixed (`CREATE OR REPLACE`, no longer hardcoded to `mock`); `record_payment_attempt()` (`SECURITY DEFINER`) and `process_payfast_itn()` (not `SECURITY DEFINER`, `service_role`-only) |

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
  architecture reserves for server-side code. Also covers the Phase 1
  business self-verification fix.
- `tests/db/listings.test.ts` (Phase 2A) — listing lifecycle visibility
  (draft/archived never public, published is), cross-seller
  modification/deletion, ownership can't be assigned on `INSERT` or
  reassigned on `UPDATE`, business-member vs. non-member authorization,
  admin access, and `storage.objects` upload/read/delete policies for
  the `product-images` bucket.
- `tests/db/search.test.ts` (Phase 3A) — `search_products()` confirmed
  not `SECURITY DEFINER`; draft/archived listings excluded from search
  by title, by category filter, by price filter, by collection/delivery
  filters, and across every page of pagination; adversarial search
  terms and sort values never error or leak private data; `total_count`
  reflects only public rows; the function's return columns never
  include a seller/owner identifier.
- `tests/db/nearby.test.ts` (Phase 3B) — the phase's 12 required privacy
  tests (anonymous/authenticated exact-coordinate access, public-query
  column shape, cross-seller location-attachment/mutation/retrieval
  attempts including a direct join through `products` into `locations`,
  RPC-parameter tampering — adversarial `sort_key`, an out-of-range
  `radius_km`, a negative `page_offset`, `category_ids` — and
  unpublished/archived exclusion), plus radius-boundary filtering
  (5/10/25/50 km against real Cape Town-area coordinates), distance
  sorting genuinely reordering results (not insertion order), every
  `search_products()`-style filter still applying, pagination/
  `total_count` correctness, confirmation that `search_nearby_products()`
  *is* `SECURITY DEFINER` (the deliberate exception to `search_products()`
  — see ARCHITECTURE.md), and that `products_pickup_location_id_idx`
  exists.
- `tests/db/location-ownership.test.ts` (Phase 3B security review) —
  the four required `profiles.location_id` ownership cases (own
  location, another user's, a nonexistent one, one not created by the
  caller — enforced on both INSERT and UPDATE, admin exempted),
  general location-mutation regression coverage (create/update own,
  cannot modify or attach another's, cannot reference a fabricated id,
  deleting a location cleanly nulls dependent references without
  affecting an unrelated user's), and `SECURITY DEFINER` search_path
  safety (`anon`/`authenticated` genuinely cannot `CREATE` in the
  `public` schema, `search_nearby_products()`'s `search_path` is
  pinned, and neither its `EXECUTE` grant nor
  `product_locations_public`'s `SELECT` grant includes `PUBLIC`).
- `tests/db/orders.test.ts` (Phase 4A, 35 tests) — the full required
  transaction-security scenario list: authentication, product
  eligibility (nonexistent/draft/archived/own/already-sold), price/
  commission/seller/buyer cannot be client-supplied (confirmed against
  `create_order()`'s actual `pg_proc.proargnames`, not just by reading
  the migration), buyer/seller RLS-scoped access, order/payment status
  and financial fields can't be modified by a normal client,
  `transaction_events` append-only (both the RLS-silent-0-rows case and
  the trigger-level case reached via `service_role`), a real
  `Promise.allSettled` concurrent-request race test, a real
  duplicate-submission test, commission rounding, fulfilment-method
  validation, and the function's own `SECURITY DEFINER`/`search_path`/
  grant posture.
- `tests/db/payfast.test.ts` (Phase 4B, 31 tests) —
  `record_payment_attempt()`/`process_payfast_itn()` against a real
  Postgres engine: auth/ownership on payment initiation, retry-after-
  failure allowed, a completed payment never replaced, amount/status
  verification, the full idempotency and state-machine matrix (PAID
  protected from downgrade to either PENDING or FAILED, duplicate
  COMPLETE/CANCELLED events produce no duplicate `transaction_events`
  row, a genuine FAILED → PAID retry succeeds), commission/payouts/
  listing-status untouched by payment confirmation, and both
  functions' `SECURITY DEFINER`/grant posture (including a direct
  `service_role`-vs-`authenticated`-vs-`anon` access-control check on
  `process_payfast_itn()` itself). PayFast's own protocol verification
  (signature/host/query-validate) is unit-tested separately, against
  fixtures, in `src/server/payments/providers/payfast/*.test.ts` — this
  file covers what happens after that verification has already
  succeeded.

**Limitations of this approach**, so results aren't over-trusted: PGlite
is a real Postgres engine, but this is not the full Supabase platform —
there's no real GoTrue, PostgREST, or Storage service, and
`auth.users`/`auth.uid()`/`storage.objects` are small hand-built
stand-ins for what Supabase actually provisions (matched to the columns
our migrations' own policies reference, e.g. `raw_user_meta_data` and
`storage.foldername()`'s `[1]` index — not their full real schemas or
HTTP-layer behavior like signed-URL generation or upload size/MIME
enforcement). A clean `tests/db` run is strong evidence the schema and
RLS policies are internally consistent; it is not a substitute for
running the real Supabase CLI + Docker stack at least once before
production.
