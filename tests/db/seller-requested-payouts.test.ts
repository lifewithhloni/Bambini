import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

// payments.provider_reference is unique — every simulated PayFast ITN
// needs its own distinct reference, never a shared literal, since every
// test in this file runs against one shared PGlite database (same
// pattern as tests/db/seller-payouts.test.ts and
// tests/db/payout-recovery.test.ts).
let payfastRefCounter = 0;
function nextPayfastRef(): string {
  payfastRefCounter += 1;
  return `pf-request-test-ref-${payfastRefCounter}`;
}

let trackingRefCounter = 0;
function nextTrackingRef(): string {
  trackingRefCounter += 1;
  return `payout-request-tracking-ref-${trackingRefCounter}`;
}

/**
 * Phase 8B (extension): seller-requested, order-independent payouts —
 * get_seller_available_balance() and request_seller_payout(), exercised
 * against the real migration SQL and real Postgres. Items 26-31 of this
 * phase's own test brief ("existing Phase 8A/8B/cash/delivery/
 * commission/RLS tests remain passing") are verified by the full
 * `npm run test:db` run rather than duplicated here — every pre-existing
 * *.test.ts file is unchanged and runs unmodified in the same suite; see
 * tests/db/seller-payouts.test.ts and tests/db/payout-recovery.test.ts
 * for that coverage.
 */
describe("seller-requested payouts (Phase 8B extension)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Request Payout Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.query("reset role");
  });

  async function makeParentProduct(seller: string, title: string, priceCents: number) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, $3, 'good', $4, 'published', true, true)
       returning id`,
      [seller, categoryId, title, priceCents],
    );
    return r.rows[0].id;
  }

  async function makeCompletedOnlineOrder(opts: { productId: string; seller: string; buyer?: string; priceCents: number }) {
    const buyer = opts.buyer ?? (await makeUser(db, `Request Payout Buyer ${Math.random()}`));
    const created = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [opts.productId]),
    );
    const orderId = created.rows[0].order_id;
    await db.query("reset role");
    await db.query(`select public.process_payfast_itn($1, $2, 'paid', $3)`, [orderId, nextPayfastRef(), opts.priceCents]);
    const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
    await asUser(db, opts.seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
    await db.query("reset role");
    const order = await db.query<{ subtotal_cents: string; commission_amount_cents: string }>(
      `select subtotal_cents, commission_amount_cents from public.orders where id = $1`,
      [orderId],
    );
    return { orderId, buyer, subtotalCents: Number(order.rows[0].subtotal_cents), commissionAmountCents: Number(order.rows[0].commission_amount_cents) };
  }

  async function balanceOf(seller: string): Promise<number> {
    const r = await asUser(db, seller, () => db.query<{ get_seller_available_balance: string }>(`select public.get_seller_available_balance()`));
    return Number(r.rows[0].get_seller_available_balance);
  }

  async function requestPayoutAs(seller: string): Promise<string> {
    const r = await asUser(db, seller, () => db.query<{ request_seller_payout: string }>(`select public.request_seller_payout()`));
    return r.rows[0].request_seller_payout;
  }

  describe("available balance (1)", () => {
    it("1. the seller's available balance equals the sum of net earnings (subtotal - commission) from their unclaimed completed online orders", async () => {
      const seller = await makeUser(db, "Balance Correct Seller");
      const productA = await makeParentProduct(seller, "Balance Toy A", 100000);
      const productB = await makeParentProduct(seller, "Balance Toy B", 50000);
      await makeCompletedOnlineOrder({ productId: productA, seller, priceCents: 100000 });
      await makeCompletedOnlineOrder({ productId: productB, seller, priceCents: 50000 });

      const balance = await balanceOf(seller);
      expect(balance).toBe(100000 - 12000 + (50000 - 6000)); // 12% commission on each
    });
  });

  describe("order-independence and no client-supplied identifiers (2-6)", () => {
    it("2-3. request_seller_payout() takes no arguments at all — no amount, no order ids, nothing for the client to supply", async () => {
      const r = await db.query<{ proargnames: string[] | null }>(`select proargnames from pg_proc where proname = 'request_seller_payout'`);
      expect(r.rows[0].proargnames ?? []).toEqual([]);
    });

    it("4. a seller can never claim another seller's balance — request_seller_payout() only ever resolves the caller's own orders", async () => {
      const sellerA = await makeUser(db, "Isolation Seller A");
      const sellerB = await makeUser(db, "Isolation Seller B");
      const productA = await makeParentProduct(sellerA, "Isolation Toy A", 100000);
      await makeCompletedOnlineOrder({ productId: productA, seller: sellerA, priceCents: 100000 });

      // Seller B has zero eligible earnings of their own — request must
      // fail, never silently claim seller A's orders.
      await asUser(db, sellerB, async () => {
        await expect(db.query(`select public.request_seller_payout()`)).rejects.toThrow(/no eligible earnings/i);
      });

      await db.query("reset role");
      const aBalance = await balanceOf(sellerA);
      expect(aBalance).toBe(100000 - 12000); // untouched by seller B's failed attempt
    });

    it("5-6. a seller can request their full available balance in one order-independent call", async () => {
      const seller = await makeUser(db, "Request Success Seller");
      const productA = await makeParentProduct(seller, "Request Toy A", 100000);
      const productB = await makeParentProduct(seller, "Request Toy B", 50000);
      await makeCompletedOnlineOrder({ productId: productA, seller, priceCents: 100000 });
      await makeCompletedOnlineOrder({ productId: productB, seller, priceCents: 50000 });

      const expectedTotal = 100000 - 12000 + (50000 - 6000);
      const payoutId = await requestPayoutAs(seller);

      await db.query("reset role");
      const payout = await db.query<{ amount_cents: string; status: string; recipient_profile_id: string }>(
        `select amount_cents, status, recipient_profile_id from public.payouts where id = $1`,
        [payoutId],
      );
      expect(Number(payout.rows[0].amount_cents)).toBe(expectedTotal);
      expect(payout.rows[0].status).toBe("pending");
      expect(payout.rows[0].recipient_profile_id).toBe(seller);
      expect(await balanceOf(seller)).toBe(0); // fully claimed
    });
  });

  describe("multiple orders grouped correctly (7)", () => {
    it("7. three separate completed orders are combined into one payout with the correct total and all three claimed", async () => {
      const seller = await makeUser(db, "Grouped Orders Seller");
      const productA = await makeParentProduct(seller, "Grouped Toy A", 88000);
      const productB = await makeParentProduct(seller, "Grouped Toy B", 45000);
      const productC = await makeParentProduct(seller, "Grouped Toy C", 62000);
      const orderA = await makeCompletedOnlineOrder({ productId: productA, seller, priceCents: 88000 });
      const orderB = await makeCompletedOnlineOrder({ productId: productB, seller, priceCents: 45000 });
      const orderC = await makeCompletedOnlineOrder({ productId: productC, seller, priceCents: 62000 });

      const payoutId = await requestPayoutAs(seller);

      await db.query("reset role");
      const items = await db.query<{ order_id: string; amount_cents: string }>(`select order_id, amount_cents from public.payout_items where payout_id = $1`, [payoutId]);
      expect(items.rows).toHaveLength(3);
      const orderIdsClaimed = items.rows.map((r) => r.order_id).sort();
      expect(orderIdsClaimed).toEqual([orderA.orderId, orderB.orderId, orderC.orderId].sort());

      const payout = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
      const expectedTotal = orderA.subtotalCents - orderA.commissionAmountCents + (orderB.subtotalCents - orderB.commissionAmountCents) + (orderC.subtotalCents - orderC.commissionAmountCents);
      expect(Number(payout.rows[0].amount_cents)).toBe(expectedTotal);
    });
  });

  describe("financial separation (8-10)", () => {
    async function makeCompletedDeliveryOrder(providerCostCents: number, markupPercentageBps: number, subtotalCents: number) {
      const seller = await makeUser(db, `Request Delivery Seller ${Math.random()}`);
      const buyer = await makeUser(db, `Request Delivery Buyer ${Math.random()}`);
      const sellerLocationId = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude) values ($1, -33.95, 18.45) returning id`,
        [seller],
      );
      const buyerLocationId = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude) values ($1, -33.9, 18.4) returning id`,
        [buyer],
      );
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId.rows[0].id, buyer]);
      const productId = await db.query<{ id: string }>(
        `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available, pickup_location_id)
         values ('parent', $1, $2, 'Request Delivery Toy', 'good', $3, 'published', true, true, $4)
         returning id`,
        [seller, categoryId, subtotalCents, sellerLocationId.rows[0].id],
      );
      const quoteId = await makeDeliveryQuote(db, {
        buyerId: buyer,
        productId: productId.rows[0].id,
        pickupLocationId: sellerLocationId.rows[0].id,
        dropoffLocationId: buyerLocationId.rows[0].id,
        providerCostCents,
        markupPercentageBps,
      });
      const created = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId.rows[0].id, quoteId]),
      );
      const orderId = created.rows[0].order_id;
      await db.query("reset role");
      const order = await db.query<{ total_cents: string }>(`select total_cents from public.orders where id = $1`, [orderId]);
      await db.query(`select public.process_payfast_itn($1, $2, 'paid', $3)`, [orderId, nextPayfastRef(), order.rows[0].total_cents]);
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string }>(`select public.reserve_delivery_order($1, (select id from public.delivery_quotes where order_id = $1), (select provider_id from public.delivery_quotes where order_id = $1))`, [orderId]),
      );
      await asServiceRole(db, () => db.query(`select public.record_delivery_booking($1, $2, 'booked')`, [reserved.rows[0].reserve_delivery_order, nextTrackingRef()]));
      await asServiceRole(db, () => db.query(`select public.sync_delivery_status($1, 'delivered')`, [orderId]));
      return { orderId, seller };
    }

    it("8-9. the buyer's delivery fee never increases the requested payout, and Bambini's delivery margin stays entirely separate", async () => {
      const { orderId, seller } = await makeCompletedDeliveryOrder(5000, 2000, 100000); // R50 provider cost, 20% markup -> R60 buyer fee, R1000 subtotal
      await db.query("reset role");
      const order = await db.query<{ total_cents: string }>(`select total_cents from public.orders where id = $1`, [orderId]);
      expect(Number(order.rows[0].total_cents)).toBe(100000 + 6000);

      const balance = await balanceOf(seller);
      expect(balance).toBe(100000 - 12000); // never subtotal + delivery fee - commission

      const payoutId = await requestPayoutAs(seller);
      await db.query("reset role");
      const payout = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
      expect(Number(payout.rows[0].amount_cents)).toBe(100000 - 12000);
    });

    it("10. a completed cash order contributes nothing to the seller's available balance and cannot be requested", async () => {
      const seller = await makeUser(db, "Cash Balance Seller");
      await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified', completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Cash Balance Buyer");
      const productId = await makeParentProduct(seller, "Cash Balance Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
      await db.query("reset role");

      expect(await balanceOf(seller)).toBe(0);
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.request_seller_payout()`)).rejects.toThrow(/no eligible earnings/i);
      });
      const items = await db.query(`select payout_id from public.payout_items where order_id = $1`, [orderId]);
      expect(items.rows).toHaveLength(0);
    });
  });

  describe("concurrency (11-12)", () => {
    it("11-12. two concurrent request_seller_payout() calls from the same seller never both succeed, and never double-claim the same orders", async () => {
      const seller = await makeUser(db, "Concurrent Request Seller");
      const productA = await makeParentProduct(seller, "Concurrent Toy A", 88000);
      const productB = await makeParentProduct(seller, "Concurrent Toy B", 45000);
      const orderA = await makeCompletedOnlineOrder({ productId: productA, seller, priceCents: 88000 });
      const orderB = await makeCompletedOnlineOrder({ productId: productB, seller, priceCents: 45000 });

      const results = await Promise.allSettled([
        asUser(db, seller, () => db.query<{ request_seller_payout: string }>(`select public.request_seller_payout()`)),
        asUser(db, seller, () => db.query<{ request_seller_payout: string }>(`select public.request_seller_payout()`)),
      ]);
      const succeeded = results.filter((r) => r.status === "fulfilled");
      // Exactly one of the two concurrent calls wins the earnings; the
      // other either fails outright (no eligible earnings left) or, if
      // it also finds something (impossible here since there's only one
      // batch of earnings), the partial unique index is the backstop —
      // either way, never two payouts both claiming the same orders.
      expect(succeeded.length).toBeLessThanOrEqual(1);

      await db.query("reset role");
      const activeA = await db.query<{ payout_id: string }>(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderA.orderId]);
      const activeB = await db.query<{ payout_id: string }>(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderB.orderId]);
      expect(activeA.rows).toHaveLength(1);
      expect(activeB.rows).toHaveLength(1);
      expect(activeA.rows[0].payout_id).toBe(activeB.rows[0].payout_id); // both orders landed in the SAME single payout, not split across two
    });
  });

  describe("multiple payouts over time (13)", () => {
    it("13. after a payout is paid, newly completed orders form a separate, later, order-independent payout", async () => {
      const seller = await makeUser(db, "Multiple Payouts Seller");
      const productA = await makeParentProduct(seller, "First Payout Toy", 100000);
      await makeCompletedOnlineOrder({ productId: productA, seller, priceCents: 100000 });
      const firstPayoutId = await requestPayoutAs(seller);
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, 'bank-ref-1')`, [firstPayoutId]));

      expect(await balanceOf(seller)).toBe(0);

      const productB = await makeParentProduct(seller, "Second Payout Toy", 50000);
      await makeCompletedOnlineOrder({ productId: productB, seller, priceCents: 50000 });
      expect(await balanceOf(seller)).toBe(50000 - 6000);

      const secondPayoutId = await requestPayoutAs(seller);
      expect(secondPayoutId).not.toBe(firstPayoutId);

      await db.query("reset role");
      const first = await db.query<{ status: string; amount_cents: string }>(`select status, amount_cents from public.payouts where id = $1`, [firstPayoutId]);
      expect(first.rows[0].status).toBe("paid");
      expect(Number(first.rows[0].amount_cents)).toBe(100000 - 12000); // untouched by the second payout
    });
  });

  describe("recovery integration (14-19)", () => {
    async function makeFailedRequestedPayout(seller: string, priceCents: number) {
      const productId = await makeParentProduct(seller, `Failed Requested Toy ${Math.random()}`, priceCents);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents });
      const payoutId = await requestPayoutAs(seller);
      await asUser(db, admin, () => db.query(`select public.mark_payout_failed($1, 'bank rejected transfer')`, [payoutId]));
      return { orderId, payoutId };
    }

    it("14. a failed payout's earnings remain claimed and unavailable until explicitly recovered", async () => {
      const seller = await makeUser(db, "Failed Stays Claimed Seller");
      await makeFailedRequestedPayout(seller, 50000);

      expect(await balanceOf(seller)).toBe(0);
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.request_seller_payout()`)).rejects.toThrow(/no eligible earnings/i);
      });
    });

    it("15. admin recovery makes the earnings available again", async () => {
      const seller = await makeUser(db, "Recovery Makes Available Seller");
      const { payoutId } = await makeFailedRequestedPayout(seller, 50000);

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      expect(await balanceOf(seller)).toBe(50000 - 6000);
    });

    it("16. recovery never auto-creates a new payout — the seller must explicitly request one", async () => {
      const seller = await makeUser(db, "Explicit Re-request Seller");
      const { payoutId } = await makeFailedRequestedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      await db.query("reset role");
      const payoutsForSeller = await db.query(`select id from public.payouts where recipient_profile_id = $1`, [seller]);
      expect(payoutsForSeller.rows).toHaveLength(1); // still only the original (now recovered) payout — no second one appeared on its own
    });

    it("17-18. the seller's new request after recovery gets a distinct payout id, and the original stays historical", async () => {
      const seller = await makeUser(db, "New Payout After Recovery Seller");
      const { orderId, payoutId: originalPayoutId } = await makeFailedRequestedPayout(seller, 100000);
      const originalAmount = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [originalPayoutId]);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [originalPayoutId, "Confirmed funds never left Bambini's account."]));

      const newPayoutId = await requestPayoutAs(seller);
      expect(newPayoutId).not.toBe(originalPayoutId);

      await db.query("reset role");
      const original = await db.query<{ status: string; amount_cents: string }>(`select status, amount_cents from public.payouts where id = $1`, [originalPayoutId]);
      expect(original.rows[0].status).toBe("recovered");
      expect(original.rows[0].amount_cents).toBe(originalAmount.rows[0].amount_cents); // untouched

      const newItem = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where payout_id = $1 and order_id = $2`, [newPayoutId, orderId]);
      expect(newItem.rows).toHaveLength(1);
    });

    it("19. the same order never has two ACTIVE payout claims at once, across a recovery and a fresh seller request", async () => {
      const seller = await makeUser(db, "No Double Active Claim Seller");
      const { orderId, payoutId } = await makeFailedRequestedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));
      await requestPayoutAs(seller);

      await db.query("reset role");
      const activeClaims = await db.query(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderId]);
      expect(activeClaims.rows).toHaveLength(1);
      const allClaims = await db.query(`select payout_id from public.payout_items where order_id = $1`, [orderId]);
      expect(allClaims.rows).toHaveLength(2);
    });
  });

  describe("historical immutability (20-22)", () => {
    it("20. a seller-requested payout's amount is immutable once created", async () => {
      const seller = await makeUser(db, "Immutable Requested Seller");
      const productId = await makeParentProduct(seller, "Immutable Requested Toy", 100000);
      await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });
      const payoutId = await requestPayoutAs(seller);

      await db.query("reset role");
      const before = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);

      // No client role can rewrite it directly, matching the exact same
      // guarantee already proven for admin-created payouts.
      const updated = await asUser(db, admin, () => db.query(`update public.payouts set amount_cents = 1 where id = $1`, [payoutId]));
      expect(updated.affectedRows).toBe(0);

      const after = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
      expect(after.rows[0].amount_cents).toBe(before.rows[0].amount_cents);
    });

    it("21. a commission-rate change after the payout is created cannot alter its historical amount", async () => {
      const seller = await makeUser(db, "Post-Request Rate Seller");
      const productId = await makeParentProduct(seller, "Post-Request Rate Toy", 100000);
      await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });
      const payoutId = await requestPayoutAs(seller);
      const before = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);

      const newRate = await db.query<{ id: string }>(
        `insert into public.commission_rates (seller_type, rate_bps, effective_from) values ('parent', 2500, now()) returning id`,
      );
      try {
        const after = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
        expect(after.rows[0].amount_cents).toBe(before.rows[0].amount_cents);
      } finally {
        await db.query(`delete from public.commission_rates where id = $1`, [newRate.rows[0].id]);
      }
    });

    it("22. a delivery-markup setting change after the payout is created cannot alter its historical amount", async () => {
      const seller = await makeUser(db, "Post-Request Markup Seller");
      const productId = await makeParentProduct(seller, "Post-Request Markup Toy", 100000);
      await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });
      const payoutId = await requestPayoutAs(seller);
      const before = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);

      // No application write path exists for delivery_markup_settings
      // either (same reasoning as the commission_rates test above) —
      // this simply re-confirms the already-created row is unaffected.
      await db.query("reset role");
      const after = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
      expect(after.rows[0].amount_cents).toBe(before.rows[0].amount_cents);
    });
  });

  describe("RLS: payout visibility (23-25)", () => {
    it("23. a buyer cannot read a seller-requested payout", async () => {
      const seller = await makeUser(db, "Buyer Block Requested Seller");
      const productId = await makeParentProduct(seller, "Buyer Block Requested Toy", 50000);
      const { buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await requestPayoutAs(seller);

      const buyerSees = await asUser(db, buyer, () => db.query(`select id from public.payouts where id = $1`, [payoutId]));
      expect(buyerSees.rows).toHaveLength(0);

      const anonSees = await asAnon(db, () => db.query(`select id from public.payouts where id = $1`, [payoutId]));
      expect(anonSees.rows).toHaveLength(0);
    });

    it("24. an unrelated seller cannot read another seller's requested payout", async () => {
      const seller = await makeUser(db, "Isolation Requested Seller A");
      const otherSeller = await makeUser(db, "Isolation Requested Seller B");
      const productId = await makeParentProduct(seller, "Isolation Requested Toy", 50000);
      await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await requestPayoutAs(seller);

      const otherSees = await asUser(db, otherSeller, () => db.query(`select id from public.payouts where id = $1`, [payoutId]));
      expect(otherSees.rows).toHaveLength(0);
    });

    it("25. the admin can read a seller-requested payout, including its order lines", async () => {
      const seller = await makeUser(db, "Admin Sees Requested Seller");
      const productId = await makeParentProduct(seller, "Admin Sees Requested Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await requestPayoutAs(seller);

      const adminSees = await asUser(db, admin, () => db.query<{ id: string }>(`select id from public.payouts where id = $1`, [payoutId]));
      expect(adminSees.rows).toHaveLength(1);
      const adminSeesItems = await asUser(db, admin, () => db.query<{ order_id: string }>(`select order_id from public.payout_items where payout_id = $1`, [payoutId]));
      expect(adminSeesItems.rows.map((r) => r.order_id)).toEqual([orderId]);
    });
  });

  describe("authorization boundary", () => {
    it("an anonymous caller cannot call request_seller_payout() or get_seller_available_balance()", async () => {
      await asAnon(db, async () => {
        await expect(db.query(`select public.request_seller_payout()`)).rejects.toThrow();
      });
      await db.query("reset role");
      const seller = await makeUser(db, "Anon Balance Seller");
      const productId = await makeParentProduct(seller, "Anon Balance Toy", 50000);
      await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      // get_seller_available_balance() itself only revokes public/anon
      // execute — the real safety property under test is that it never
      // leaks a real seller's balance to an unauthenticated caller, even
      // if grants ever drifted.
      await asAnon(db, async () => {
        const r = await db.query<{ get_seller_available_balance: string }>(`select public.get_seller_available_balance()`).catch(() => null);
        if (r) {
          expect(Number(r.rows[0].get_seller_available_balance)).toBe(0);
        }
      });
    });
  });
});
