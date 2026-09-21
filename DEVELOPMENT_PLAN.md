# Bambini — Development Plan

Per the development rules: build in small, reviewable phases; no phase
builds marketplace UI ahead of the foundation it depends on; each phase
ends in a working, tested state before the next starts.

## Phase 0 — Foundation (this phase)

**Status: done, pending local verification.**

- Next.js + TypeScript (strict) + Tailwind CSS scaffolded.
- ESLint + Prettier configured and passing.
- Folder structure established (`src/server/` for business logic,
  isolated from `src/app/`).
- Supabase client structure (browser/server/admin) without requiring
  production credentials.
- Full initial database schema as version-controlled migrations, with RLS
  on every table (see [DATABASE.md](DATABASE.md)).
- Payment-provider and delivery-provider abstractions, each with a
  working mock adapter and unit tests.
- Commission calculation and cash-eligibility rules engine, pure
  functions with unit tests.
- `ARCHITECTURE.md`, `DATABASE.md`, `ENVIRONMENT.md`, `DECISIONS.md`,
  this file.

**Before Phase 1 starts:**

1. Run `supabase start && supabase db reset` locally (or against a real
   Supabase project) and confirm every migration applies cleanly — this
   has been reviewed carefully but not executed against real Postgres in
   this environment (no Docker available here). Fix anything that
   doesn't apply before building on top of it.
2. Create the real Supabase project (or confirm the local one), fill in
   `.env.local` from `.env.example`.
3. Resolve the open decisions in [DECISIONS.md](DECISIONS.md) that block
   Phase 1 (auth UI approach, storage bucket policy details).

## Phase 1 — Auth and profile foundation

**Status: done, pending real-Supabase-backend verification.**

- Sign up / sign in / sign out (Supabase Auth, email + password).
- `/account` (protected, server-rendered per-request) showing full
  name/phone with an edit form; `handle_new_user()` from the foundation
  phase creates the profile automatically.
- Home-location editing deliberately **not** built this phase — it's a
  location-picker UI that belongs with Nearby (Phase 3), not identity.
- Protected-route pattern (`requireUser()`), a non-throwing variant for
  UI that must degrade gracefully (`getOptionalUser()`), and an
  open-redirect-safe `?next=` round-trip.
- Exit criteria met: a user can register, land on a protected profile
  page, and their `profiles` row is correct (role defaults to `parent`,
  auto-created); RLS verified by both automated tests (`tests/db/`) and
  a real HTTP round-trip through a browser attempting to read/write
  another user's data.
- Found and fixed during this phase: a business could be self-verified
  via a crafted `INSERT` — see DECISIONS.md.
- Not yet done: a real signup/login against actual Supabase Auth (no
  GoTrue available in this environment) — see DECISIONS.md item 9.

## Phase 2A — Listing foundation (parent + business seller compatible)

**Status: done, pending real-Supabase-backend verification (see
DECISIONS.md items 10-11).**

- "Sell Something" flow: photos (private Supabase Storage bucket,
  signed URLs), category picker (from `categories`, no hard-coded
  list), condition (Like New/Excellent/Good/Fair), price (Rand input →
  integer cents), description, collection/delivery toggle.
- Explicit draft/published/archived lifecycle
  (`src/server/listings/statusTransitions.ts`); publish requires at
  least one photo; only a draft can be hard-deleted, anything else must
  be archived.
- Seller dashboard (`/sell`): view/create/edit/publish/unpublish/
  archive/delete, grouped by status.
- Public listing page (`/listings/[id]`): images, title, price,
  condition, description, category, seller name + rating (via
  `profiles_public`/`businesses_public`, never the raw row), collection/
  delivery availability — never exact coordinates or private contact
  info. No checkout yet.
- Ownership hardening found and fixed: `products` UPDATE policy now has
  an explicit `WITH CHECK` (was already enforced implicitly, verified);
  `product_images.storage_path` is bound to its own `product_id` by a
  `CHECK` constraint, closing a path where a seller could reference
  another seller's uploaded file in their own listing.
- Schema/RLS/action layer supports business-owned listings
  (`seller_type = 'business'`, `is_business_member()`-checked) and is
  tested as such — no business-listing UI toggle yet, since business
  storefront onboarding (creating/joining a business) is Phase 7.
- Exit criteria met: a parent can create, edit, publish, and archive a
  listing end to end; category tree is fully database-driven; anonymous
  users can only ever see published listings (proven by
  `tests/db/listings.test.ts`, not just code review).
- Not yet done: real Supabase Storage smoke test (no GoTrue/Storage
  service available in this environment — see DECISIONS.md item 10).

## Phase 3A — Marketplace browse & search

**Status: done, pending real-Supabase-backend verification (see
DECISIONS.md items 12-13).**

- Public homepage (`/`): search bar, database-driven category nav,
  "Recently listed" (real published data, no fabricated "Popular"
  section — see DECISIONS.md), "Sell something" CTA.
- Server-side search (`/search?q=...`): title + description, via a new
  `search_products()` Postgres function — not client-side filtering,
  not raw PostgREST `.or()` string-building (see DECISIONS.md).
- Category browsing (`/category/[slug]`): parent categories resolve to
  every leaf descendant's listings; leaf categories browse directly —
  reuses the existing category tree, no duplicated category logic.
- Filters (category, price min/max, condition, collection/delivery) and
  sort (newest/price asc/price desc, double-allowlisted) — all
  server-side, all shareable/bookmarkable URLs.
- Deterministic offset pagination with a documented cursor-pagination
  upgrade path for when the catalogue is large enough to need it.
- Reusable `ProductCard`/`ListingGrid`, batched signed-URL image
  fetching (no N+1).
- Exit criteria met: `tests/db/search.test.ts` (20 tests) proves
  anonymous users only ever see published listings through search, at
  every filter combination and every page, and that a malicious sort
  value can't reach an arbitrary column — not just verified by
  inspection.
- Found and fixed during this phase: search/browse pages crashed with a
  raw 500 if Supabase was unreachable (`getCategoryTree()` threw
  uncaught) — added `src/app/error.tsx`, a proper Next.js error
  boundary.
- Not yet done: real Supabase Storage/query-planner-at-scale
  verification (no Docker in this environment — see DECISIONS.md).

## Phase 3B — Nearby + location privacy

**Status: done, pending real-Supabase-backend verification (see
DECISIONS.md items 14-15).**

- `/nearby`: radius filter (5/10/25/50 km, clamped server- and
  DB-side), preserves every `search_products()` filter (category,
  price, condition, collection, delivery), sort (Distance/Newest/
  Price asc/Price desc — distance computed and ordered by PostGIS,
  never in React), pagination — all via `search_nearby_products()`
  (extended in place from the foundation phase, see ARCHITECTURE.md),
  called through `src/server/search/searchNearby.ts`.
- `/account/location`: one saved location per seller/buyer
  (`profiles.location_id`, unused since Phase 0), set via an explicit
  "Use my current location" button (`navigator.geolocation`, never
  automatic) plus self-reported suburb/city/province — no geocoding
  provider, no full street address collected.
- Listing create/edit auto-attaches the seller's own saved location to
  `products.pickup_location_id` whenever collection is offered
  (`resolveOwnPickupLocationId()`), never a client-supplied value.
- Product detail page's `product_locations_public` suburb/city display
  (Phase 2A) is unchanged — already correct for this phase.
- Exit criteria met: nearby distance is correct (real PostGIS
  computation, verified against real coordinates in
  `tests/db/nearby.test.ts`) and no raw coordinates, address, or
  location id ever appear in a public query response — proven by all
  12 of the phase's required privacy tests passing against a real
  Postgres/PostGIS engine, not just verified by inspection. A seller
  cannot attach, retrieve, or mutate another seller's location, enforced
  by RLS (`WITH CHECK`), not application code.
- Found and fixed during this phase: a PL/pgSQL pitfall where
  `ORDER BY distance_km` (referencing the SELECT list's own alias)
  silently resolved to the function's always-`NULL` `RETURNS TABLE` OUT
  parameter of the same name instead, making distance sort a no-op —
  see ARCHITECTURE.md and the migration's own comment.
- Not yet done: real Supabase geospatial query-plan verification at
  scale, and real device GPS behavior (no Docker/real Supabase project
  in this environment — see DECISIONS.md item 14); business seller
  pickup locations (item 15, Phase 7 territory).

## Phase 4A — Buyer/seller transaction foundation

**Status: done, pending real-Supabase-backend verification.**

- One-listing checkout (`/checkout/[id]`) → `create_order()`, a new
  `SECURITY DEFINER` Postgres function that atomically flips the
  product `published` → `sold` (the foundation phase's own inert `sold`
  label, now real — this is the overselling *and* duplicate-submission
  guard, one mechanism for both), then creates the `orders`/
  `order_items`/`payments`/`commissions`/`transaction_events`
  (`order.created`) rows in the same transaction. Every financial value
  (price, commission rate/amount, totals, buyer, seller) is derived
  server-side from the product row and `auth.uid()` — no form field
  the client submits is ever trusted for any of them.
- Commission is snapshotted at creation from `commission_rates`
  (already seeded: parent 1200 bps / business 1500 bps since the
  foundation phase) — mirrors `calculateCommission()`'s own
  round-half-up integer-cents formula, not a second implementation of
  it.
- A public-safe `orders.order_reference` (`BMB-XXXXXX`) is generated by
  a column default, not application code.
- Buyer (`/account/orders`, `/account/orders/[id]`) and seller
  (`/sell/orders`, `/sell/orders/[id]`) order views, using RLS policies
  that already existed unused since the foundation phase
  (`orders_select_participant_or_admin` etc.) — no new SELECT policy
  was needed. Commission is shown only on the seller-framed detail
  page, never the buyer's.
- No payment provider, delivery provider, or cash collection — every
  order is created `status = 'pending_payment'` / payment
  `status = 'pending'`, honestly reflecting that nothing has actually
  been paid yet.
- Exit criteria met: `tests/db/orders.test.ts` (35 tests) proves the
  full required scenario list — price/commission/seller/buyer cannot
  be client-overridden, unpublished/archived/own/already-sold listings
  can't be bought, two concurrent buyers for the same listing can't
  both succeed, a duplicate/retried request can't create a second
  order, order/payment status and financial fields can't be modified
  by a normal client, `transaction_events` stays append-only — against
  a real Postgres/PostGIS engine, not just verified by inspection.
- Not yet done: real Supabase query-planner/scale verification (no
  Docker/live project in this environment); Phase 4B (real payment
  provider integration, cash collection, delivery booking, business
  seller checkout UI).

## Phase 5 — Delivery integration

- Delivery quote comparison at checkout using the mock delivery provider
  (Cheapest/Standard/Express).
- Delivery order booking and status tracking.
- First real provider adapter (pick one — see Decisions).
- Exit criteria: a real provider can be swapped in via config alone, no
  checkout code changes required.

## Phase 6 — Cash collection

- Cash-at-collection option at checkout, gated by
  `seller_cash_status.is_eligible`.
- Collection code generation and seller-side confirmation flow.
- Admin-configurable `cash_eligibility_criteria` UI.
- Exit criteria: a brand-new seller cannot offer cash; a seller who
  earns eligibility can; confirming a code completes the order and
  records commission exactly as an online payment would.

## Phase 7 — Business storefronts

- Business registration, verification submission/review, storefront
  page, catalogue/stock management, business-role dashboard.
- Exit criteria: a verified business can list, sell, and be paid out at
  the 15% rate, indistinguishable in checkout from a parent seller except
  for rate and storefront branding.

## Phase 8 — Messaging and reviews

- Buyer↔seller messaging tied to a product/order.
- Post-completion reviews.
- Exit criteria: messaging and reviews respect RLS (only participants see
  a thread; only the actual buyer of a completed order can review).

## Phase 9 — Payouts and admin dashboard

- Payout computation job (service-role, scheduled), payout history.
- Admin dashboard: verification review, dispute/report resolution,
  commission-rate and cash-eligibility-criteria management.
- Exit criteria: an admin can approve a verification, adjust a commission
  rate (without touching historical orders), and resolve a dispute — all
  logged to `admin_actions`.

## Phase 10 — Promotions, Parent+, notifications

- Promoted listings (R30/R60/R100), Parent+ subscription (R59/month).
- Notification delivery (in-app first; email/push later).

## Phase 11 — Trust and safety hardening

- Reporting flow, dispute resolution UX, account standing enforcement.
- RLS policy review/tightening pass and policy tests (see
  [DECISIONS.md](DECISIONS.md)).

## Phase 12 — Real provider integration and launch hardening

- Replace mock payment/delivery providers with real ones in production.
- Load-test `search_nearby_products` and add caching/read replicas if
  needed.
- Security review, error tracking, monitoring, CI hardening.

## Ongoing, every phase

- Unit tests for new business logic in `src/server/`.
- `npm run lint && npm run typecheck && npm run test` clean before
  calling a phase done.
- New migrations only ever added, never edited after being applied
  anywhere shared.
- Update `DECISIONS.md` when a non-obvious architectural choice is made.
