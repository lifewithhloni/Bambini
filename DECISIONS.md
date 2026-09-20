# Bambini — Architectural Decisions

Short log of non-obvious decisions made in the foundation phase, why, and
what's still open. Add to this as the project grows instead of letting
rationale live only in commit messages or chat history.

## Decided

**Database/RLS validation uses PGlite, not the Docker-based Supabase
CLI, in environments without Docker.** `supabase start` requires Docker
or Podman; neither is installed on this machine. Rather than only
reviewing the migration SQL by eye, `tests/db/` boots
[PGlite](https://pglite.dev) (real Postgres compiled to WASM, with a
real PostGIS build) and runs the actual migrations and actual RLS
policies against it, with a small hand-built `auth.users`/`auth.uid()`
stand-in for what Supabase's platform provisions. This caught one real
gap during validation: the hand-built `auth.users` stub was initially
missing the `raw_user_meta_data` column that `handle_new_user()` reads —
a test-harness fidelity bug, not a migration bug, fixed by matching the
stub to Supabase's real `auth.users` shape. It is not a substitute for
running the real Supabase CLI + Docker stack at least once — see
DATABASE.md's "Automated tests" section for exactly what this does and
doesn't prove.

**Security-test assertions must check `affectedRows`, not just whether a
statement throws.** An `UPDATE`/`DELETE` blocked by RLS does not raise a
Postgres error — it silently matches 0 rows, identical to a `WHERE`
clause that matches nothing. Early versions of the RLS test suite
asserted "the statement must throw" for `UPDATE`s that should have been
blocked (e.g. a seller updating `commissions`), which meant a query that
was actually blocked correctly (0 rows affected, data unchanged) still
reported as a failure. Fixed by asserting `affectedRows === 0` plus a
follow-up read confirming the data genuinely didn't change, which is the
same pattern already used correctly for the `orders`/`products` tests.
`INSERT`s with no matching policy *do* throw ("new row violates
row-level security policy"), so "cannot forge a row" assertions
correctly expect a thrown error instead.

**Found and fixed in Phase 1: a user could self-verify a business (or
their own identity/business-verification submission) by including the
status column in the row's very first `INSERT`.** The foundation-phase
RLS policies restricted which columns a user could `UPDATE` on
`profiles`/`businesses` (e.g. `verification_status` isn't grantable) but
never applied the same restriction to `INSERT` — so
`insert into businesses (owner_profile_id, business_name, slug,
verification_status) values (auth.uid(), 'x', 'y', 'verified')` passed
RLS (which only checked `owner_profile_id = auth.uid()`) and actually
set `verification_status = 'verified'`, confirmed exploitable with a
throwaway script before writing the fix. Migration
`20260920100000_restrict_insert_columns.sql` mirrors the existing
UPDATE column grants onto INSERT for `profiles`, `businesses`,
`business_verifications`, and `identity_verifications`: the sensitive
columns are simply not in the granted list, so they fall back to their
`DEFAULT` (e.g. `'unverified'`) no matter what the client sends,
regardless of whether application code remembers to omit them. Now
permanently tested in `tests/db/rls.test.ts` ("users cannot assign
themselves admin or business privileges").

**Business is a capability, not a profile role.** `profiles.role` is only
`parent` or `admin`. A storefront (`businesses`) is owned by a profile
and is additive. Rejected alternative: a `business` value on
`profiles.role`, which would force a choice between "this person is a
business" and "this person is a parent," directly contradicting "a
parent can both buy and sell" (and, implicitly, also run a storefront).
Phase 1's brief asked to "support the existing Bambini roles: parent,
business, admin" and "not allow self-assignment of admin or business
privileges" — read as *use the roles this schema already has* rather
than *add a third enum value*, since the brief also says role changes
must follow "the existing database/RLS architecture." "Business
privileges" is therefore enforced as: a user can create a `businesses`
row they own (Phase 7 will build the UI for this), but cannot set
`verification_status`/`account_standing`/rating fields on it — see the
INSERT-column-grant entry below, which is exactly this rule enforced at
the database level, discovered while testing this phase's role
protections.

**Signed-up profiles are auto-created via a DB trigger, not application
code, and start unverified.** `handle_new_user()` (from the foundation
phase) already does this — Phase 1's sign-up Server Action never writes
to `profiles` directly, it only calls `supabase.auth.signUp()` and lets
the trigger do it. This is also what makes "duplicate/retry-safe" free:
the trigger runs in the same transaction as the `auth.users` insert, so
there's no window where an auth account exists without a profile, and a
concurrent double sign-up just gets Supabase Auth's own duplicate-email
error — no extra application code needed to guard against a race.

**A page showing one user's own data is always `force-dynamic`,
regardless of whether the build environment has real Supabase
credentials.** `/account` is marked this way not to work around this
sandbox's missing env vars (though it does that too) but because
letting Next.js statically prerender a per-user page would risk serving
one user's cached account page to everyone — a real correctness bug,
not just a build nicety. Site-wide UI that reads auth state but isn't
gating access (the header) instead uses `getOptionalUser()`, which
swallows any error (missing config, unreachable Supabase) and renders
"logged out" rather than take the whole page down — discovered because
adding a Supabase-aware header to the root layout broke `npm run build`
for every page, not just protected ones.

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

**Phase 2A: renamed enum labels (`RENAME VALUE`) rather than adding new
ones or recreating the types.** The foundation phase's `product_status`
had `active`/`sold`/`removed`; the agreed listing model wants
`draft`/`published`/`archived` with no order-related state. Renaming
`active` → `published` (and `product_condition`'s `new` → `excellent`)
preserves the enum's OID, so every *stored* object that referenced the
old label — RLS policies, the `product_locations_public` view —
picks up the new one automatically, verified against a real engine
before relying on it. One real exception found the same way:
`search_nearby_products()`, a `language sql` function, does **not**
get this for free — Postgres re-validates a SQL-language function's
literal text against the current catalog on each call rather than
freezing it at creation time, so its `'active'` literal had to be
updated explicitly (`20260921090000_align_listing_labels.sql`) or every
call failed with "invalid input value for enum". `sold`/`removed` are
left as inert, never-written labels rather than dropped outright —
Postgres has no `DROP VALUE` for enums, so removing them means
recreating the type and cascading through every dependent view/policy/
function for no functional gain this phase; revisit if a future phase
actually wants to use one of them (e.g. Phase 4 wanting `sold`, Phase 9
wanting `removed` for moderation) rather than doing it preemptively.

**Phase 2A: made the `products_update_owner_or_admin` UPDATE policy's
`WITH CHECK` explicit**, mirroring the same "make an implicit Postgres
default visible" move as Phase 1's profiles-role hardening. Postgres
already defaulted the check to the `USING` clause (verified, not
assumed), so this doesn't change behavior — it just means "a seller
can't reassign who owns a listing via UPDATE" is a line of SQL a future
reader can see, not a fact they have to already know about Postgres.
One genuinely new finding while testing this: an `UPDATE` that matches
`USING` but then fails `WITH CHECK` *throws* ("new row violates
row-level security policy"), unlike an `UPDATE` that never matched
`USING` in the first place, which silently affects 0 rows — two
different failure shapes for what looks like the same "blocked" outcome
from the outside, both now covered by tests that got this wrong on the
first pass and were corrected after checking real behavior instead of
assuming it (same lesson as Phase 1, still worth re-learning per table).

**Phase 2A: the `product-images` Storage bucket changed from public to
private**, reversing the `public = true` set in the foundation phase's
`supabase/config.toml`. That setting predated any real thought about
draft-listing photo privacy; a public bucket serves objects from an
endpoint that bypasses RLS entirely, which cannot satisfy "a draft
listing's photos aren't publicly viewable." Reads now go through
signed URLs (`src/server/listings/imageUrls.ts`), minted per-viewer
from their own session so RLS still applies to who can get one.

**Phase 2A: the listing create/edit UI only ever creates a `parent`-
type listing, but the schema/RLS/server-action layer is fully
`business`-listing-capable and tested as such.** There's no business
storefront onboarding UI yet (that's Phase 7 — a business has to exist,
and the current user has to be a member of it, before "list as this
business" means anything in the UI). Rather than build a placeholder
business-creation flow just to exercise the business path, the create
action already accepts `sellerType`/`businessId` and relies on RLS's
`is_business_member()` check exactly as a parent listing relies on
`seller_profile_id = auth.uid()`, and `tests/db/listings.test.ts`
creates businesses/members directly to prove a member can manage a
business's listings and a non-member can't. This is the "if the schema
can't safely support business-owned listings, stop and report" case
from the Phase 2A brief resolving to "it already does" rather than a
redesign.

**Phase 2A: only a `draft` listing can be hard-deleted; anything else
must be archived.** An application-level rule
(`src/server/listings/actions.ts`), not an RLS one — RLS's own DELETE
policy allows an owner to delete a listing in any status, which is
intentionally left permissive at the database layer (useful for an
admin/support cleanup path later) while the normal seller-facing
`deleteListing` action narrows it. Reasoning: nothing references a
draft listing yet (no orders, no favourites in practice), so deleting
one is safe and total; a published-then-unlisted listing is closer to
"this used to exist" and archiving preserves that instead of erasing
it.

**Phase 2A: images upload through the Server Action (server receives
the `File` bytes), not a separate client-to-storage upload step.**
Keeps "submit the form, get one outcome" simple for this phase, at the
cost of routing image bytes through the Next.js server instead of
straight to Supabase Storage from the browser. Revisit if listings
start carrying many/large images and the extra hop becomes a real cost
— see ARCHITECTURE.md.

> **Known tech debt, deliberately not addressed now:** the current
> architecture is unchanged as of this review — server-mediated upload
> stays. Direct authenticated browser-to-Supabase-Storage uploads (the
> client uploading straight to `storage.objects`, subject to the same
> RLS policies in `20260921090200_product_images_storage_policies.sql`,
> with the app only registering the resulting `product_images` row
> afterward) may be worth considering later if listing volume or image
> sizes make routing every photo's bytes through the Next.js server
> inefficient. Not needed at this phase's scale; noted here so it isn't
> rediscovered from scratch.

**Phase 2A: no location field on the listing create/edit form.** Every
migration and RLS policy involving `products.pickup_location_id` was
already in place from the foundation phase (it's nullable), but
collecting a pickup point needs a location picker, which is Nearby's
concern (Phase 3), not identity/catalogue's — so every listing created
this phase simply has `pickup_location_id = null` until then.

## Open — needs product/stakeholder input before the relevant phase

1. **Which payment provider first?** PayFast and Yoco are the common
   South African choices (local card/EFT support); Stripe has broader
   tooling but weaker local payment-method coverage. Needed before Phase
   4/5.
2. **Which delivery provider first?** Needed before Phase 5. Affects
   what a real `DeliveryProvider` adapter has to handle (quote shape,
   booking flow, webhook vs. polling for status).
3. **Auth methods beyond email/password.** Phase 1 implements only
   email/password (as specified). Phone/OTP is common for a SA consumer
   audience and may matter more than social login — worth deciding before
   too much UI assumes email as the only identifier.
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
9. **Phase 1 auth has not been tested against a real Supabase Auth
   backend (no GoTrue).** Same root cause as item 6/DATABASE.md's
   "Automated tests" limitation — no Docker in this environment, and no
   hosted project configured. What *has* been verified: the schema/RLS
   layer for real (`tests/db/`, including new signup/role-protection
   cases), the Server Action logic in isolation (mocked Supabase client,
   `src/server/auth/*.test.ts`), and the actual UI end-to-end against a
   placeholder Supabase URL in a browser (forms submit, validation
   errors render, the protected-route redirect and `?next=` round-trip
   both work, the network failure surfaces correctly in the error state).
   What hasn't: a real signup actually creating a session, email
   confirmation flows (if enabled on a real project), and session
   persistence across a real refresh. First thing to do once real
   Supabase credentials exist.
10. **Phase 2A: Storage's real HTTP layer hasn't been exercised
    either** — same root cause as item 9. `tests/db/listings.test.ts`
    proves the `storage.objects` RLS *policy logic* is correct against a
    real Postgres engine, but PGlite has no actual Storage service, so
    signed-URL generation, upload size/MIME enforcement, and the real
    `storage.foldername()` behavior are unverified here. The
    `product-images` bucket, its RLS policies, and
    `src/server/listings/imageUrls.ts` should all be smoke-tested
    against a real Supabase project before shipping the listing flow.
11. **No business storefront onboarding UI exists yet**, so a real user
    cannot actually reach the business-listing path this phase enables
    at the schema/action layer (see the "decided" entry above) — only
    tests can exercise it, by inserting a `businesses` row directly.
    Needed before Phase 7, and worth knowing about sooner if the product
    plan wants business sellers reachable earlier than that.
