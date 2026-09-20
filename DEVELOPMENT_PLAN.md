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

- Sign up / sign in / sign out (Supabase Auth, email + password to
  start).
- Profile completion flow (full name, phone, home location).
- Basic account settings page.
- Exit criteria: a user can register, land on a profile, and their
  `profiles` row is correct; RLS verified by trying to read/write another
  user's profile and being denied.

## Phase 2 — Parent seller: list a product

- "Sell Something" flow: photos (Supabase Storage), category picker
  (from `categories`), condition, price, collection/delivery toggle,
  publish.
- Seller's own listing management (edit, mark sold, archive).
- Exit criteria: a parent can create, edit, and publish a listing end to
  end; category tree is fully database-driven with no hard-coded list in
  the app.

## Phase 3 — Browse, search, nearby

- Category browse, keyword search, condition/price filters.
- Nearby (5/10/25/50 km) using `search_nearby_products()`.
- Product detail page using `product_locations_public` for
  suburb/city display.
- Exit criteria: nearby distance is correct and no raw coordinates ever
  appear in a network response to the browser (verified by inspection).

## Phase 4 — Checkout and payments (mock provider)

- Cart → checkout → order creation, using `calculateCommission()` and the
  mock payment provider end to end.
- Order status pages for buyer and seller.
- Exit criteria: an order can be placed and paid (mock) and the resulting
  `orders`/`payments`/`commissions`/`transaction_events` rows are all
  correct.

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
