# Bambini — Architectural Decisions

Short log of non-obvious decisions made in the foundation phase, why, and
what's still open. Add to this as the project grows instead of letting
rationale live only in commit messages or chat history.

## Decided

**Business is a capability, not a profile role.** `profiles.role` is only
`parent` or `admin`. A storefront (`businesses`) is owned by a profile
and is additive. Rejected alternative: a `business` value on
`profiles.role`, which would force a choice between "this person is a
business" and "this person is a parent," directly contradicting "a
parent can both buy and sell" (and, implicitly, also run a storefront).

**Money-moving tables get no direct client write access.** `orders`,
`payments`, `commissions`, `payouts`, etc. are SELECT-only for
`authenticated` via RLS; every write goes through the service-role client
after server-side validation. Rejected alternative: model the full order
state machine as RLS `UPDATE` policies with `WITH CHECK` transition
rules. That's possible, but for a state machine this size (10 order
statuses, cash vs. online, collection vs. delivery) it becomes hard to
audit and easy to leave a gap; a single, testable server-side code path
is more defensible for money. Trade-off: more server code to write later;
worth it here.

**Commission/rates are snapshotted onto the order, not looked up live.**
`orders.commission_rate_bps` and `.commission_amount_cents` are set once
at order creation. `commission_rates` is an append-only history table so
"what rate applies right now" can change for new orders without ever
altering a historical one. Same pattern for `order_items.price_cents_snapshot`
and `promotions.price_cents_snapshot`.

**Money as integer cents everywhere**, not `numeric`/`decimal` prices or
floats. Simpler arithmetic, no float rounding bugs, matches how
`calculateCommission()` is implemented and tested. Every new code path
touching an amount must keep to this convention — worth a lint rule or
shared `Money` type if it becomes a real footgun in practice.

**Public location reads only through `SECURITY DEFINER`
functions/views** (`search_nearby_products`, `product_locations_public`),
never a public RLS policy on `locations` itself. This makes "what can a
stranger learn about a seller's address" a property of a handful of
hand-written SQL functions rather than of a general-purpose RLS policy
that has to be exactly right for every future query shape.

**`transaction_events` is append-only by trigger, not just RLS.** RLS is
bypassed by the service-role key by design, so a trigger is the only
mechanism that also protects the audit log from an accidental server-side
`UPDATE`/`DELETE`.

**Mock providers ship in the foundation, real ones don't.** Both payment
and delivery abstractions have a working, tested, zero-config mock
adapter so checkout/delivery flows are buildable and testable before any
vendor account exists. Real adapters are Phase 5+ (see
[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)).

**Vitest over Jest.** Faster, simpler config with Next.js + TypeScript,
no need for Jest's broader ecosystem for pure business-logic unit tests
at this stage.

**No ORM.** Supabase's generated types
(`npm run db:types`) plus the `@supabase/supabase-js` query builder are
enough for this schema's access patterns; an ORM (Prisma/Drizzle) is
extra abstraction and a second source of truth for the schema without a
clear win here. Revisit if query complexity grows past what the builder
handles comfortably.

## Open — needs product/stakeholder input before the relevant phase

1. **Which payment provider first?** PayFast and Yoco are the common
   South African choices (local card/EFT support); Stripe has broader
   tooling but weaker local payment-method coverage. Needed before Phase
   4/5.
2. **Which delivery provider first?** Needed before Phase 5. Affects
   what a real `DeliveryProvider` adapter has to handle (quote shape,
   booking flow, webhook vs. polling for status).
3. **Auth methods beyond email/password** — phone/OTP is common for a SA
   consumer audience and may matter more than social login. Needed before
   Phase 1.
4. **Cash eligibility default thresholds** — the seed values (3 completed
   transactions, 4.0 minimum rating, account + identity verification
   required, 0 unresolved disputes) are reasonable defaults, not a
   product decision. Confirm before Phase 6.
5. **Storage bucket policy details** — `product-images` is public,
   `verification-documents` is private in `supabase/config.toml`; the
   actual RLS-equivalent storage policies (who can upload/read which
   paths) haven't been written yet. Needed before Phase 2 (images) and
   Phase 1/7 (verification documents).
6. **RLS security review.** The policies in this foundation are a
   careful first pass, not a security audit. Get an independent review
   (and ideally automated policy tests) before real money moves through
   the system — flagged as a phase in
   [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) (Phase 11) but worth doing
   earlier if the timeline allows.
7. **Payout schedule/method** — how often payouts run and how money
   actually reaches a seller's bank account (manual EFT initially? a
   payout API?) isn't decided. Needed before Phase 9.
8. **PostGIS/Postgres version** — `supabase/config.toml` pins
   `major_version = 17`; confirm this matches whatever Supabase's CLI
   supports at the time `supabase start` is actually run, and adjust if
   not.
