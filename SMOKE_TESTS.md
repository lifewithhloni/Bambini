# Bambini — Production Smoke-Test Plan

Phase 15C/16. This checklist has not been executed against any real
external environment — it is the checklist a human runs, not a report of
results. Every test below states its own purpose, prerequisites, steps,
expected result, and pass/fail criteria, so it can be handed to anyone —
not just someone who already knows this codebase — and run against:

1. **Supabase** (the production project, or a project standing in for it)
2. **Vercel Preview** (a PR deployment)
3. **PayFast Sandbox** (via that Preview deployment)
4. **Production** (the live Vercel deployment, live Supabase, live PayFast)

## Environment tags

- **SANDBOX TEST** — run against a Preview deployment with
  `PAYFAST_SANDBOX=true` (or unset) and, ideally, non-production data.
  Safe to create real rows, real orders, real disputes — nothing here is
  real money or a real customer. This is where every write-action test
  belongs.
- **PRODUCTION READ-ONLY CHECK** — safe to run against the live
  production URL. Creates no new state, spends no money, changes nothing.
- **PRODUCTION TRANSACTION TEST** — creates real state or moves real
  money in production. Marked explicitly wherever it appears; never
  bundled into routine verification, and never run without the team
  deciding to run it.

No test below is a PRODUCTION TRANSACTION TEST unless labelled as one,
and none were executed while writing this document.

---

## Auth

**A1. Sign up** `[SANDBOX TEST]`
Purpose: confirm a brand-new account can be created.
Prerequisites: a Preview deployment; an email address not already registered.
Steps: 1) Open `/signup`. 2) Submit a new email/password/full name.
Expected result: a "check your email" confirmation state — no active session yet (email confirmation is required, `supabase/config.toml`'s `enable_confirmations = true`).
Pass: the confirmation-pending state is shown. Fail: an active session starts immediately, or a 500 error.

**A2. Email confirmation** `[SANDBOX TEST]`
Purpose: confirm the confirmation link actually activates the account.
Prerequisites: A1 completed; access to that inbox.
Steps: 1) Open the confirmation email. 2) Click the link.
Expected result: redirected into the app, signed in.
Pass: session is active post-click. Fail: link errors, or account stays unconfirmed.

**A3. Log in** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK — your own real account only]`
Purpose: confirm sign-in works for a confirmed account.
Prerequisites: a confirmed account and its real password.
Steps: 1) Open `/login`. 2) Submit correct credentials.
Expected result: redirected to `/account` (or the `next` param if one was set).
Pass: session active, correct redirect. Fail: error, or redirect to an unexpected page.

**A4. Wrong password gives a generic error** `[SANDBOX TEST]`
Purpose: confirm the anti-enumeration behaviour (`signIn()` in `src/server/auth/actions.ts`) actually reaches the UI.
Prerequisites: a known confirmed account.
Steps: 1) Submit that email with a wrong password. 2) Submit a non-existent email with any password.
Expected result: both show the identical "Incorrect email or password." message.
Pass: message is identical in both cases. Fail: the two cases are distinguishable.

**A5. Log out** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm the session actually ends.
Prerequisites: a signed-in session.
Steps: 1) Click log out. 2) Reload `/account`.
Expected result: redirected to `/login`.
Pass: no longer able to view account pages. Fail: still signed in after logout.

**A6. Protected route redirect + return** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm `requireUser()` and `safeRedirectPath()` work together correctly.
Prerequisites: signed-out browser session.
Steps: 1) While signed out, open `/account/orders`. 2) Note the URL. 3) Log in.
Expected result: redirected to `/login?next=%2Faccount%2Forders`; after login, landed back on `/account/orders`.
Pass: both the redirect-out and the return trip work. Fail: lands somewhere else, or the `next` param is ignored/unsafe (e.g. an absolute external URL is honored).

**A7. Phone verification while the flow is OFF** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm that with `PHONE_VERIFICATION_ENABLED` unset/`false`, the page is honest and nothing can be bypassed.
Prerequisites: a signed-in user whose phone is not verified.
Steps: 1) Open `/account/verification`. 2) Try to publish a listing or buy.
Expected result: the Phone row reads "Currently unavailable" (never "Verified") with no number/code form; publishing and buying are refused with the account-verification error.
Pass: no verified claim and no way past the gate. Fail: "Verified" shown, a code form appears, or a transaction goes through.

**A8. Phone verification end to end** `[SANDBOX TEST]` — **only after an SMS provider is connected and `PHONE_VERIFICATION_ENABLED=true` on the Preview** (not possible before then)
Purpose: confirm the real Supabase phone OTP flow, throttling and the gate.
Prerequisites: provider connected (see DEPLOYMENT.md "Connecting an SMS provider"), migration `20261016090000` applied, a signed-in user with a real South African mobile.
Steps: 1) Enter `082 123 4567`-style number, send code. 2) Confirm the SMS arrives and the page shows "Awaiting code". 3) Try Resend immediately (should be disabled for the cooldown), then after it. 4) Enter a wrong code 5 times. 5) Request a fresh code and enter it correctly. 6) Enter a number already used by another account.
Expected result: step 4 locks the form with a "too many attempts" message; step 5 (after the lockout window) shows Verified and `can_transact()` reflects it; step 6 shows the generic "couldn't send a code" message, identical to any other send failure.
Pass: every step behaves as described and no code or number appears in any log. Fail: a code is logged/returned, the lockout doesn't engage, or step 6 reveals the number is registered.

## Identity

**I1. Submit identity verification** `[SANDBOX TEST]`
Purpose: confirm the submission flow works end to end.
Prerequisites: a signed-in, unverified account; a test/dummy ID document image.
Steps: 1) Open `/account/verification`. 2) Submit the form with a test document.
Expected result: status becomes "Pending review."
Pass: status shown as pending, document uploaded. Fail: error, or status doesn't change.

**I2. Admin approves** `[SANDBOX TEST]`
Purpose: confirm the reviewer flow and its downstream effects.
Prerequisites: I1 completed; an admin account.
Steps: 1) As admin, open `/admin/verifications`. 2) Open the pending submission. 3) Approve.
Expected result: applicant's status becomes "Verified"; a notification is created for them.
Pass: both the status flip and the notification appear. Fail: either is missing.

**I3. Admin rejects** `[SANDBOX TEST]`
Purpose: confirm the rejection path, including that a reason is surfaced.
Prerequisites: a second pending submission; an admin account.
Steps: 1) As admin, reject with a reason. 2) As the applicant, check status.
Expected result: status becomes "Rejected"; a notification appears; the applicant can see they weren't approved (without necessarily needing the admin's exact internal note — see the Phase 15A C-2 finding on `dispute.resolution_notes` exposure, a related but distinct concern for disputes, not identity).
Pass: rejection is visible and actionable. Fail: silent failure, or status doesn't change.

**I4. Unverified account is blocked from checkout/selling** `[SANDBOX TEST]`
Purpose: confirm `can_transact()` actually gates the app, not just the UI.
Prerequisites: a signed-in, unverified account; an eligible listing.
Steps: 1) Attempt to publish a listing, or attempt checkout, while unverified.
Expected result: blocked with a clear message pointing at verification.
Pass: the action is refused server-side (not just hidden in the UI). Fail: the action succeeds while unverified.

**I5. Your own verification status page loads** `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm the read path works in production.
Prerequisites: your own real account.
Steps: 1) Open `/account/verification`.
Expected result: your real status renders, no error.
Pass/Fail: page loads correctly / page errors or shows wrong data.

## Listings

**L1. Create + publish a listing** `[SANDBOX TEST]`
Purpose: confirm the seller listing flow.
Prerequisites: a verified test seller account.
Steps: 1) `/sell/new`, fill in and save as draft. 2) Publish it.
Expected result: listing exists with `status = 'published'`.
Pass/Fail: publishes cleanly / errors, or stays draft.

**L2. Browse/search finds it** `[SANDBOX TEST]`
Purpose: confirm the new listing is discoverable.
Prerequisites: L1 completed.
Steps: 1) Search for its title on `/search`.
Expected result: it appears in results.
Pass/Fail: found / not found (allow for search indexing delay if any).

**L3. Nearby search finds it** `[SANDBOX TEST]`
Purpose: confirm location-based discovery.
Prerequisites: L1 completed with a pickup location set; a test buyer location near it.
Steps: 1) Open `/nearby` with a nearby test location.
Expected result: the listing appears, with only suburb/city shown, never exact coordinates.
Pass/Fail: appears with correct privacy-scrubbed location / doesn't appear, or leaks exact coordinates.

**L4. Listing detail page** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK — an existing real listing]`
Purpose: confirm the detail page renders fully.
Prerequisites: any published listing.
Steps: 1) Open its detail page.
Expected result: images, price, condition, seller card, and (if applicable) "Message seller" all render.
Pass/Fail: renders completely / missing images or errors.

**L5. Save/unsave** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK — your own account]`
Purpose: confirm favourites persist per-user.
Prerequisites: signed-in account; any listing.
Steps: 1) Save it. 2) Reload `/account/saved`. 3) Unsave it.
Expected result: appears after saving, gone after unsaving.
Pass/Fail: both transitions work / state doesn't persist or leaks to another account.

## Messaging

**M1. Buyer messages a seller** `[SANDBOX TEST]`
Purpose: confirm a conversation can be started from a listing.
Prerequisites: a test buyer account; someone else's published listing.
Steps: 1) Open the listing. 2) "Message seller," send a message.
Expected result: conversation appears in the buyer's inbox and the seller's.
Pass/Fail: appears in both / missing from either side.

**M2. Seller replies** `[SANDBOX TEST]`
Purpose: confirm the reply path and notification.
Prerequisites: M1 completed.
Steps: 1) As the seller, open the conversation and reply.
Expected result: reply appears for the buyer; buyer gets a "new message" notification.
Pass/Fail: both occur / either is missing.

**M3. Business messaging** `[SANDBOX TEST]`
Purpose: confirm a business listing's messages reach the whole team.
Prerequisites: a business with at least an owner and one staff member; a business listing.
Steps: 1) Message the business listing. 2) Check both the owner's and staff's business inbox.
Expected result: both see the conversation and can reply.
Pass/Fail: both can see/reply / only one can.

**M4. Your own inbox loads** `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm the read path in production.
Prerequisites: your own account with existing conversations.
Steps: 1) Open `/account/messages`.
Expected result: real conversations render.
Pass/Fail: loads correctly / errors or shows nothing when conversations exist.

## Buying

**B1. Cart → checkout → sandbox payment** `[SANDBOX TEST]`
Purpose: confirm the full online-payment purchase path.
Prerequisites: a published listing; a verified test buyer; PayFast sandbox credentials configured for Preview.
Steps: 1) Add to cart. 2) Checkout. 3) Complete payment on PayFast's sandbox page.
Expected result: order confirms, listing marked sold, order visible under "Your orders."
Pass/Fail: order confirms end to end / stalls anywhere in the chain.

**B2. Deliberately failed sandbox payment** `[SANDBOX TEST]`
Purpose: confirm a failed payment leaves the order in a clear, recoverable state — not silently "paid," not stuck.
Prerequisites: as B1, using PayFast sandbox's own test-failure flow.
Steps: 1) Start checkout. 2) Trigger a sandbox failure instead of success.
Expected result: order stays unpaid/pending, buyer can see and retry.
Pass/Fail: state is clear and recoverable / order looks paid, or disappears.

**B3. Your own past orders list** `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm the read path in production.
Prerequisites: your own account with real past orders.
Steps: 1) Open `/account/orders`.
Expected result: real orders render correctly.
Pass/Fail: loads correctly / errors, or shows another user's order.

**B4. A single real order via PayFast live** `[PRODUCTION TRANSACTION TEST]`
Purpose: confirm the live payment path actually works end to end, with real money.
Prerequisites: production PayFast credentials configured, `PAYFAST_SANDBOX=false`; explicit team sign-off to spend real money on this test.
Steps: as B1, but on the live production site with a real card.
Expected result: identical to B1's expected result, with a real charge.
Pass/Fail: order confirms with a real, verifiable charge / any part of the chain fails.
**Do not run without explicit, separate authorization at the time.**

## Cash

**C1. Collection-only cash order** `[SANDBOX TEST]`
Purpose: confirm the cash order path is independent of PayFast.
Prerequisites: a cash-eligible test seller; a collection-enabled listing.
Steps: 1) Place a cash order for collection.
Expected result: order created, `payment_method = 'cash'`, awaiting seller acceptance.
Pass/Fail: order created correctly / errors, or routes through PayFast.

**C2. Seller accepts** `[SANDBOX TEST]`
Purpose: confirm acceptance transitions the order correctly.
Prerequisites: C1 completed.
Steps: 1) As the seller, accept the cash order.
Expected result: both parties see a collection code.
Pass/Fail: code appears for both / missing for either.

**C3. Correct code completes the order** `[SANDBOX TEST]`
Purpose: confirm collection confirmation works.
Prerequisites: C2 completed.
Steps: 1) Seller enters the buyer's code.
Expected result: order completes.
Pass/Fail: completes / rejects a genuinely correct code.

**C4. Five wrong attempts locks confirmation** `[SANDBOX TEST]`
Purpose: manually re-confirm the brute-force lockout already covered by `tests/db/cash-collection.test.ts`.
Prerequisites: an active collection code.
Steps: 1) Enter a wrong code 5 times.
Expected result: 6th attempt (even with the correct code) is rejected as locked.
Pass/Fail: locks after 5 / allows more attempts.

**C5. Commission-owed reflects correctly** `[SANDBOX TEST]`
Purpose: confirm cash sellers are tracked as owing commission, not paid out.
Prerequisites: C3 completed.
Steps: 1) Check the seller's commission/settlement state (admin view).
Expected result: `owed_by_seller`-style state, not an eligible payout.
Pass/Fail: correctly tracked as owed / seller shows as payout-eligible for a cash order.

## Delivery

**D1. Quote hides provider cost** `[SANDBOX TEST]`
Purpose: confirm buyer-facing privacy of delivery economics.
Prerequisites: a delivery-enabled listing; a delivery-eligible buyer location.
Steps: 1) Request a delivery quote at checkout.
Expected result: only the buyer-facing (marked-up) price is shown — never a provider cost figure.
Pass/Fail: no cost/margin figure is ever visible to the buyer / any internal figure leaks.

**D2. Markup is server-computed** `[SANDBOX TEST]`
Purpose: confirm the buyer can't influence the delivery fee.
Prerequisites: D1.
Steps: 1) Attempt to tamper with the delivery fee via devtools/network request before submitting checkout.
Expected result: server rejects or ignores the tampered value; the order's actual `delivery_fee_cents` matches the original quote.
Pass/Fail: order uses only the server-computed fee / a tampered value is honored.

**D3. Delivery books after payment** `[SANDBOX TEST]`
Purpose: confirm the (mock) delivery provider is engaged only post-payment.
Prerequisites: B1 completed with a delivery order.
Steps: 1) After payment confirms, check the order's delivery status.
Expected result: a `delivery_orders` row exists, booked.
Pass/Fail: books correctly / no booking, or books before payment.

**D4. Tracking reflects status changes** `[SANDBOX TEST]`
Purpose: confirm tracking updates reach the order view.
Prerequisites: D3 completed.
Steps: 1) Advance the mock provider's status. 2) Reload the order page.
Expected result: status updates visibly.
Pass/Fail: reflects the update / stale or missing.

## Selling

**S1. Seller order list** `[SANDBOX TEST]` / `[PRODUCTION READ-ONLY CHECK — your own account]`
Purpose: confirm the seller-side view of a completed order.
Prerequisites: a completed order for a test/real seller.
Steps: 1) Open `/sell/orders`.
Expected result: the order appears with correct details.
Pass/Fail: correct / missing or wrong data.

**S2. Available balance reflects it** `[SANDBOX TEST]`
Purpose: confirm the balance calculation.
Prerequisites: S1.
Steps: 1) Open `/sell/payouts`.
Expected result: the completed online order's net amount is included.
Pass/Fail: correct amount shown / wrong or missing.

**S3. Request payout** `[SANDBOX TEST]`
Purpose: confirm the self-service request path.
Prerequisites: S2, a positive balance.
Steps: 1) Request a payout.
Expected result: a payout record appears with status "pending"/"requested."
Pass/Fail: created correctly / error, or seller could set their own amount/orders (they should not be able to).

**S4. Admin marks paid** `[SANDBOX TEST]`
Purpose: confirm the admin-side completion path.
Prerequisites: S3; an admin account.
Steps: 1) As admin, mark the payout paid.
Expected result: status becomes "paid"; seller sees it; a notification is created (no amount in the notification text).
Pass/Fail: all three occur correctly / any is missing or the notification leaks an amount.

**S5. Failed payout → recovery** `[SANDBOX TEST]`
Purpose: confirm the recovery path re-opens the underlying orders for a new payout without double-crediting.
Prerequisites: a payout marked "failed" by an admin.
Steps: 1) As admin, recover it with a reason. 2) Confirm the underlying orders are eligible for a new payout.
Expected result: original payout shows "recovered"; a new payout request can now claim those same orders.
Pass/Fail: correct, single re-claim path / orders become claimable twice, or never again.

## Business

**BZ1. Onboarding** `[SANDBOX TEST]`
Purpose: confirm a business can be created.
Prerequisites: a verified test account.
Steps: 1) Start business onboarding, fill in details.
Expected result: a business record exists, unverified.
Pass/Fail: created / error.

**BZ2. Verification → storefront live** `[SANDBOX TEST]`
Purpose: confirm the business verification path and its effect on visibility.
Prerequisites: BZ1; an admin account.
Steps: 1) Submit business verification documents. 2) Admin approves.
Expected result: `businesses.verification_status = 'verified'`; storefront (`/business/[slug]`) becomes publicly visible.
Pass/Fail: both occur / storefront visible before approval, or not visible after.

**BZ3. Business listing appears on storefront** `[SANDBOX TEST]`
Purpose: confirm business listings are correctly attributed.
Prerequisites: BZ2.
Steps: 1) Publish a listing as the business. 2) Open the storefront page.
Expected result: listing appears there.
Pass/Fail: appears / missing.

**BZ4. Business order → payout, scoped correctly** `[SANDBOX TEST]`
Purpose: confirm business orders/payouts don't leak into a personal seller's own view.
Prerequisites: a completed business order.
Steps: 1) Check `/account/business/[id]/orders` and `/account/business/[id]/payouts`.
Expected result: order/balance shown there, not under the owner's personal `/sell/orders`.
Pass/Fail: correctly scoped / leaks into the wrong context.

**BZ5. Team member access** `[SANDBOX TEST]`
Purpose: confirm staff get dashboard access without ownership.
Prerequisites: BZ1; a second test account added as staff.
Steps: 1) As staff, open the business dashboard.
Expected result: staff can manage listings/orders/messages but cannot request a payout (owner-only, per `request_business_payout()`'s design).
Pass/Fail: correct split of access / staff can request a payout, or can't access the dashboard at all.

**BZ6. Your own business storefront/dashboard** `[PRODUCTION READ-ONLY CHECK]`
Purpose: confirm the read path in production.
Prerequisites: your own real business.
Steps: 1) Open its dashboard and public storefront.
Expected result: both render correctly.
Pass/Fail: correct / errors or wrong data.

## Admin

**AD1. Verification review queue** `[SANDBOX TEST]`
Purpose: confirm admin review works (covered above as I2/I3; re-listed here for the admin-area checklist).
Pass/Fail: see I2/I3.

**AD2. Dispute review** `[SANDBOX TEST]`
Purpose: confirm open → respond → resolve works and notifies both sides without leaking sensitive detail.
Prerequisites: a completed order; a test buyer to open a dispute.
Steps: 1) Buyer opens a dispute. 2) Seller responds. 3) Admin resolves.
Expected result: both sides see status changes and get notifications; notification text never includes the dispute description or resolution notes.
Pass/Fail: correct end to end, no content leak / any step fails, or sensitive text appears in a notification.

**AD3. Delivery transactions admin view** `[SANDBOX TEST]`
Purpose: confirm admin-only financial visibility.
Prerequisites: a delivery order; an admin account; a non-admin account.
Steps: 1) As admin, open the delivery financial transactions view. 2) As a non-admin, attempt the same.
Expected result: admin sees provider cost/markup; non-admin is rejected.
Pass/Fail: correct split / non-admin can see it, or admin can't.

**AD4. Payouts admin view** `[SANDBOX TEST]`
Purpose: confirm the full payout admin workflow (list/mark-paid/mark-failed/recover) works together.
Pass/Fail: see S4/S5.

**AD5. Non-admin rejected everywhere** `[SANDBOX TEST]`
Purpose: confirm every admin route/action rejects a non-admin, not just hides the UI link.
Prerequisites: a non-admin account.
Steps: 1) Navigate directly to each `/admin/*` route and attempt each admin server action as a non-admin.
Expected result: rejected (redirect/404/explicit error) every time.
Pass/Fail: rejected everywhere / any route or action succeeds for a non-admin.

**AD6. Your own admin pages** `[PRODUCTION READ-ONLY CHECK — an actual admin account only]`
Purpose: confirm admin pages load with real data in production.
Pass/Fail: load correctly / error or show wrong data.

## Notifications

**N1. Qualifying event creates a notification** `[SANDBOX TEST]`
Purpose: confirm the producer triggers actually fire (message, order update, verification decision, payout outcome).
Pass/Fail: covered by M2, B1, I2/I3, S4 above — a notification appears for each.

**N2. Unread state and bell count** `[SANDBOX TEST]`
Purpose: confirm unread is real database state, not a client guess.
Prerequisites: N1.
Steps: 1) Check the header bell's count. 2) Compare to `/account/notifications`.
Expected result: they match, and match the actual number of unread rows.
Pass/Fail: consistent / bell shows a stale or invented number.

**N3. Mark one read** `[SANDBOX TEST]`
Steps: 1) Click one unread notification.
Expected result: it's marked read; the bell count decreases by exactly one.
Pass/Fail: correct / count doesn't update, or updates by the wrong amount.

**N4. Mark all read** `[SANDBOX TEST]`
Steps: 1) Click "mark all as read."
Expected result: bell count goes to zero; all rows show read.
Pass/Fail: correct / some remain unread.

**N5. Duplicate/replayed event doesn't duplicate the notification** `[SANDBOX TEST]`
Purpose: manually re-confirm the idempotency already covered by `tests/db/notifications.test.ts`.
Prerequisites: ability to resend a sandbox PayFast webhook (PayFast's own dashboard supports resending an ITN).
Steps: 1) Resend an already-processed sandbox webhook.
Expected result: no second "Payment received" notification appears.
Pass/Fail: no duplicate / a duplicate appears.

**N6. Your own notifications page** `[PRODUCTION READ-ONLY CHECK]`
Pass/Fail: loads with real notifications / errors or shows nothing when notifications exist.

## Monitoring

**MON1. Invalid PayFast webhook produces a Sentry event** `[PRODUCTION READ-ONLY CHECK]`
Purpose: the only way to confirm `SENTRY_DSN`/project/network path are all actually correct — see [DEPLOYMENT.md, step 14](DEPLOYMENT.md#14-monitoring-verification--manual-production-verification-required).
Prerequisites: `SENTRY_DSN` configured in production; a Sentry project to watch.
Steps: 1) Send one request to the production webhook URL with a deliberately invalid signature.
Expected result: request is rejected (400, no database write — confirmed safe by `route.ts`'s own logic and its test suite); a corresponding event appears in Sentry shortly after.
Pass/Fail: event appears in Sentry / nothing appears (indicates a DSN/project/network misconfiguration).
This creates no order, payment, or user-visible state — safe to run directly against production.
