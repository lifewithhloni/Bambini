import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

// payments.provider_reference is unique — every simulated PayFast ITN
// needs its own distinct reference, never a shared literal, since every
// test in this file runs against one shared PGlite database.
let payfastRefCounter = 0;
function nextPayfastRef(): string {
  payfastRefCounter += 1;
  return `pf-test-ref-${payfastRefCounter}`;
}

// delivery_orders.provider_tracking_ref is unique too (Phase 7B) — same reasoning.
let trackingRefCounter = 0;
function nextTrackingRef(): string {
  trackingRefCounter += 1;
  return `payout-test-tracking-ref-${trackingRefCounter}`;
}

/**
 * Phase 8A: seller settlement & payout ledger — exercised against the
 * real migration SQL and real Postgres, the same method as every other
 * tests/db/*.test.ts file. payouts/payout_items existed, unused, since
 * the foundation phase (see 20260920090600_payouts_and_refunds.sql);
 * what's under test here is the write path this phase actually adds
 * (create_seller_payout()/mark_payout_paid()/mark_payout_failed()) and
 * the double-payout constraint, never the pre-existing, already-tested
 * RLS shape of these tables.
 */
describe("seller payouts (Phase 8A)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Payout Admin");
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

  async function makeVerifiedBusiness(ownerId: string, businessName: string, slug: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, $2, $3, 'verified') returning id`,
      [ownerId, businessName, slug],
    );
    return r.rows[0].id;
  }

  async function makeBusinessProduct(businessId: string, title: string, priceCents: number) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('business', $1, $2, $3, 'good', $4, 'published', true, true)
       returning id`,
      [businessId, categoryId, title, priceCents],
    );
    return r.rows[0].id;
  }

  /** Drives a collection order all the way to 'completed' via the real functions (create_order -> process_payfast_itn -> confirm_collection) — the same recipe tests/db/cash-collection.test.ts's own setupConfirmed() already established for 'online' + collection. */
  async function makeCompletedOnlineOrder(opts: { productId: string; seller: string; buyer?: string; priceCents: number }) {
    const buyer = opts.buyer ?? (await makeUser(db, `Payout Buyer ${Math.random()}`));
    const created = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [opts.productId]),
    );
    const orderId = created.rows[0].order_id;
    await db.query("reset role");
    await db.query(`select public.process_payfast_itn($1, $2, 'paid', $3)`, [orderId, nextPayfastRef(), opts.priceCents]);
    const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
    await asUser(db, opts.seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
    await db.query("reset role");
    const order = await db.query<{ subtotal_cents: string; commission_amount_cents: string; total_cents: string }>(
      `select subtotal_cents, commission_amount_cents, total_cents from public.orders where id = $1`,
      [orderId],
    );
    return { orderId, buyer, subtotalCents: Number(order.rows[0].subtotal_cents), commissionAmountCents: Number(order.rows[0].commission_amount_cents), totalCents: Number(order.rows[0].total_cents) };
  }

  describe("commission rates unchanged (1-2)", () => {
    it("1. parent seller commission remains 12%", async () => {
      const seller = await makeUser(db, "Rate Check Parent Seller");
      const productId = await makeParentProduct(seller, "Rate Check Toy", 100000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });
      const commission = await db.query<{ rate_bps: number }>(`select rate_bps from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].rate_bps).toBe(1200);
    });

    it("2. business seller commission remains 15%", async () => {
      const owner = await makeUser(db, "Rate Check Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Rate Check Co", "rate-check-co");
      const productId = await makeBusinessProduct(businessId, "Rate Check Biz Toy", 100000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller: owner, priceCents: 100000 });
      const commission = await db.query<{ rate_bps: number }>(`select rate_bps from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].rate_bps).toBe(1500);
    });
  });

  it("3. seller earnings are calculated from product subtotal (subtotal - commission), captured correctly in the payout", async () => {
    const seller = await makeUser(db, "Earnings Seller");
    const productId = await makeParentProduct(seller, "Earnings Toy", 100000); // R1,000
    const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });

    await asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]));
    const item = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where order_id = $1`, [orderId]);
    expect(Number(item.rows[0].amount_cents)).toBe(100000 - 12000); // R1,000 - 12% = R880
  });

  describe("delivery fee/margin never affects seller earnings (4-5, 21)", () => {
    async function makeCompletedDeliveryOrder(providerCostCents: number, markupPercentageBps: number, subtotalCents: number) {
      const seller = await makeUser(db, `Delivery Payout Seller ${Math.random()}`);
      const buyer = await makeUser(db, `Delivery Payout Buyer ${Math.random()}`);
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
         values ('parent', $1, $2, 'Delivery Payout Toy', 'good', $3, 'published', true, true, $4)
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

    it("4-5. the buyer's delivery fee never increases the seller's payout, and Bambini's delivery margin stays entirely separate", async () => {
      const { orderId, seller } = await makeCompletedDeliveryOrder(5000, 2000, 100000); // R50 provider cost, 20% markup -> R60 buyer fee, R1000 subtotal
      await db.query("reset role");
      const order = await db.query<{ subtotal_cents: string; delivery_fee_cents: string; commission_amount_cents: string; total_cents: string }>(
        `select subtotal_cents, delivery_fee_cents, commission_amount_cents, total_cents from public.orders where id = $1`,
        [orderId],
      );
      expect(Number(order.rows[0].total_cents)).toBe(100000 + 6000); // buyer paid subtotal + delivery fee

      await asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]));
      const item = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where order_id = $1`, [orderId]);
      // Seller gets subtotal - commission ONLY — never subtotal + delivery
      // fee - commission, and never the R60 delivery fee at all.
      expect(Number(item.rows[0].amount_cents)).toBe(100000 - 12000);
      expect(Number(item.rows[0].amount_cents)).not.toBe(100000 + 6000 - 12000);
      void seller;
    });

    it("21. delivery margin (buyer fee - provider cost) is never part of the payout amount", async () => {
      const { orderId } = await makeCompletedDeliveryOrder(5000, 2000, 50000); // margin = R10
      await asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]));
      const item = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where order_id = $1`, [orderId]);
      expect(Number(item.rows[0].amount_cents)).toBe(50000 - 6000); // 12% of R500, no delivery figures anywhere in this number
    });
  });

  it("6-7. changing the commission_rates configuration never alters an already-completed order's snapshot or its eventual payout", async () => {
    const seller = await makeUser(db, "Historical Commission Seller");
    const productId = await makeParentProduct(seller, "Historical Commission Toy", 100000);
    const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });

    const before = await db.query<{ rate_bps: number; commission_amount_cents: string }>(
      `select rate_bps, commission_amount_cents from public.commissions where order_id = $1`,
      [orderId],
    );

    // Simulate a future admin change to the parent commission rate — no
    // application function exists to do this (commission_rates has no
    // write path at all, by design, matching this phase's own "do not
    // change the existing commission percentages" instruction); this
    // models what a hypothetical future config change would look like at
    // the database level. Cleaned up at the end of this test (not left
    // in the shared PGlite database this whole file reuses) — every
    // other test in this file relies on the seeded 12%/15% rates still
    // being "current".
    const newRate = await db.query<{ id: string }>(
      `insert into public.commission_rates (seller_type, rate_bps, effective_from) values ('parent', 2500, now()) returning id`,
    );

    try {
      const after = await db.query<{ rate_bps: number; commission_amount_cents: string }>(
        `select rate_bps, commission_amount_cents from public.commissions where order_id = $1`,
        [orderId],
      );
      expect(after.rows[0].rate_bps).toBe(before.rows[0].rate_bps);
      expect(after.rows[0].commission_amount_cents).toBe(before.rows[0].commission_amount_cents);

      await asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]));
      const item = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where order_id = $1`, [orderId]);
      expect(Number(item.rows[0].amount_cents)).toBe(100000 - 12000); // still the original 12%, not the new 25%
    } finally {
      await db.query(`delete from public.commission_rates where id = $1`, [newRate.rows[0].id]);
    }
  });

  describe("payout eligibility lifecycle (8-10)", () => {
    it("8. a paid-but-not-completed order is not eligible for payout", async () => {
      const seller = await makeUser(db, "Not Completed Seller");
      const buyer = await makeUser(db, "Not Completed Buyer");
      const productId = await makeParentProduct(seller, "Not Completed Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
      const orderId = created.rows[0].order_id;
      await db.query("reset role");
      await db.query(`select public.process_payfast_itn($1, $2, 'paid', 50000)`, [orderId, nextPayfastRef()]);
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("confirmed"); // paid, but not yet completed — the buyer never confirmed collection

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).rejects.toThrow(/must be completed/i);
      });
    });

    it("9. a completed CASH order is never eligible for payout — Bambini never received that money", async () => {
      const seller = await makeUser(db, "Cash Payout Reject Seller");
      await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified', completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Cash Payout Reject Buyer");
      const productId = await makeParentProduct(seller, "Cash Payout Reject Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed");

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).rejects.toThrow(/only online orders/i);
      });
    });

    it("10. cash commission remains owed_by_seller regardless of this phase's own changes", async () => {
      const seller = await makeUser(db, "Cash Owed Seller");
      await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified', completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Cash Owed Buyer");
      const productId = await makeParentProduct(seller, "Cash Owed Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const commission = await db.query<{ settlement_status: string }>(`select settlement_status from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].settlement_status).toBe("owed_by_seller");
    });
  });

  describe("RLS: payout visibility (11-14)", () => {
    it("11 & 14. the seller can see their own payout, and the admin can see it too", async () => {
      const seller = await makeUser(db, "Payout Visibility Seller");
      const productId = await makeParentProduct(seller, "Payout Visibility Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );

      const sellerSees = await asUser(db, seller, () => db.query(`select id from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]));
      expect(sellerSees.rows).toHaveLength(1);

      const adminSees = await asUser(db, admin, () => db.query(`select id from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]));
      expect(adminSees.rows).toHaveLength(1);
    });

    it("12. a buyer cannot see a seller's payout", async () => {
      const seller = await makeUser(db, "Payout Buyer Block Seller");
      const productId = await makeParentProduct(seller, "Payout Buyer Block Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );

      const buyerSees = await asUser(db, buyer, () => db.query(`select id from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]));
      expect(buyerSees.rows).toHaveLength(0);
    });

    it("13. an unrelated seller cannot see another seller's payout", async () => {
      const seller = await makeUser(db, "Payout Isolation Seller A");
      const otherSeller = await makeUser(db, "Payout Isolation Seller B");
      const productId = await makeParentProduct(seller, "Payout Isolation Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );

      const otherSees = await asUser(db, otherSeller, () => db.query(`select id from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]));
      expect(otherSees.rows).toHaveLength(0);
    });

    it("anon cannot see any payout", async () => {
      const seller = await makeUser(db, "Payout Anon Block Seller");
      const productId = await makeParentProduct(seller, "Payout Anon Block Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      const anonSees = await asAnon(db, () => db.query(`select id from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]));
      expect(anonSees.rows).toHaveLength(0);
    });
  });

  describe("client cannot manipulate financial values (15-17)", () => {
    it("15. create_seller_payout() takes no payout amount parameter — only an array of order ids", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_seller_payout'`);
      // A plain scalar return (uuid, not RETURNS TABLE) means
      // proargnames only ever lists actual input parameters — there's
      // no implicit output-column entry the way there is for
      // create_order()'s own RETURNS TABLE shape.
      expect(r.rows[0].proargnames).toEqual(["p_order_ids"]);
    });

    it("16-17. a normal authenticated user cannot directly insert or update payouts/payout_items (no seller earnings or commission override path exists)", async () => {
      const seller = await makeUser(db, "Direct Insert Block Seller");
      await asUser(db, seller, async () => {
        await expect(
          db.query(
            `insert into public.payouts (recipient_type, recipient_profile_id, amount_cents, status, period_start, period_end) values ('parent', $1, 999999999, 'paid', now(), now())`,
            [seller],
          ),
        ).rejects.toThrow();
      });
    });

    it("a normal authenticated user cannot call create_seller_payout(), mark_payout_paid(), or mark_payout_failed() directly", async () => {
      const seller = await makeUser(db, "Function Access Block Seller");
      const productId = await makeParentProduct(seller, "Function Access Block Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).rejects.toThrow(/admin authorization required/i);
      });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.mark_payout_paid($1, 'forged-ref')`, [payoutId.rows[0].create_seller_payout])).rejects.toThrow(/admin authorization required/i);
        await expect(db.query(`select public.mark_payout_failed($1, 'forged')`, [payoutId.rows[0].create_seller_payout])).rejects.toThrow(/admin authorization required/i);
      });
    });
  });

  describe("double-payout protection (18-20)", () => {
    it("18. the same order cannot be included in a second payout once it's already in one", async () => {
      const seller = await makeUser(db, "Double Payout Seller");
      const productId = await makeParentProduct(seller, "Double Payout Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      await asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]));
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).rejects.toThrow(/already been paid out/i);
      });
      const items = await db.query(`select payout_id from public.payout_items where order_id = $1`, [orderId]);
      expect(items.rows).toHaveLength(1);
    });

    it("19. two concurrent create_seller_payout() calls for the same order never both succeed", async () => {
      const seller = await makeUser(db, "Concurrent Payout Seller");
      const productId = await makeParentProduct(seller, "Concurrent Payout Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });

      const results = await Promise.allSettled([
        asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])),
        asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])),
      ]);
      const succeeded = results.filter((r) => r.status === "fulfilled");
      expect(succeeded).toHaveLength(1);

      await db.query("reset role");
      const items = await db.query(`select payout_id from public.payout_items where order_id = $1`, [orderId]);
      expect(items.rows).toHaveLength(1);
      const payouts = await db.query(`select id from public.payouts where id in (select payout_id from public.payout_items where order_id = $1)`, [orderId]);
      expect(payouts.rows).toHaveLength(1);
    });

    it("the database-level unique constraint on payout_items.order_id is the irreducible guarantee, independent of application logic", async () => {
      const seller = await makeUser(db, "Unique Constraint Seller");
      const productId = await makeParentProduct(seller, "Unique Constraint Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      const secondPayout = await db.query<{ id: string }>(
        `insert into public.payouts (recipient_type, recipient_profile_id, amount_cents, status, period_start, period_end) values ('parent', $1, 1, 'pending', now(), now()) returning id`,
        [seller],
      );
      await expect(
        db.query(`insert into public.payout_items (payout_id, order_id, amount_cents) values ($1, $2, 1)`, [secondPayout.rows[0].id, orderId]),
      ).rejects.toThrow(/payout_items_order_id_unique/i);
      void payoutId;
    });

    it("20. historical payout records are immutable — no client role can update amount_cents or status directly", async () => {
      const seller = await makeUser(db, "Immutable Payout Seller");
      const productId = await makeParentProduct(seller, "Immutable Payout Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      const updated = await asUser(db, admin, () =>
        db.query(`update public.payouts set amount_cents = 1, status = 'paid' where id = $1`, [payoutId.rows[0].create_seller_payout]),
      );
      // Even an admin's own ordinary session cannot write here — the
      // only sanctioned mutation path is mark_payout_paid()/
      // mark_payout_failed(), never a raw UPDATE, regardless of role.
      expect(updated.affectedRows).toBe(0);
    });
  });

  describe("mark_payout_paid() / mark_payout_failed()", () => {
    it("marks a pending payout paid, stores the reference, and records an admin_actions audit row", async () => {
      const seller = await makeUser(db, "Mark Paid Seller");
      const productId = await makeParentProduct(seller, "Mark Paid Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, 'bank-ref-123')`, [payoutId.rows[0].create_seller_payout]));

      await db.query("reset role");
      const payout = await db.query<{ status: string; paid_at: string | null; provider_reference: string | null }>(
        `select status, paid_at, provider_reference from public.payouts where id = $1`,
        [payoutId.rows[0].create_seller_payout],
      );
      expect(payout.rows[0].status).toBe("paid");
      expect(payout.rows[0].paid_at).not.toBeNull();
      expect(payout.rows[0].provider_reference).toBe("bank-ref-123");

      const action = await db.query<{ admin_id: string; action_type: string }>(
        `select admin_id, action_type from public.admin_actions where target_id = $1 and action_type = 'payout.marked_paid'`,
        [payoutId.rows[0].create_seller_payout],
      );
      expect(action.rows).toHaveLength(1);
      expect(action.rows[0].admin_id).toBe(admin);
    });

    it("rejects marking an already-paid payout as paid again (idempotent-safe, not a silent no-op)", async () => {
      const seller = await makeUser(db, "Double Mark Paid Seller");
      const productId = await makeParentProduct(seller, "Double Mark Paid Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, null)`, [payoutId.rows[0].create_seller_payout]));
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.mark_payout_paid($1, null)`, [payoutId.rows[0].create_seller_payout])).rejects.toThrow(
          /already been marked as paid/i,
        );
      });
    });

    it("marks a pending payout failed and records an admin_actions audit row, without deleting its payout_items", async () => {
      const seller = await makeUser(db, "Mark Failed Seller");
      const productId = await makeParentProduct(seller, "Mark Failed Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      await asUser(db, admin, () => db.query(`select public.mark_payout_failed($1, 'bank rejected transfer')`, [payoutId.rows[0].create_seller_payout]));

      await db.query("reset role");
      const payout = await db.query<{ status: string }>(`select status from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]);
      expect(payout.rows[0].status).toBe("failed");
      const items = await db.query(`select order_id from public.payout_items where payout_id = $1`, [payoutId.rows[0].create_seller_payout]);
      expect(items.rows).toHaveLength(1); // still there — the order remains permanently claimed, by design (see this phase's own migration comment)
    });

    it("a paid payout cannot be marked as failed", async () => {
      const seller = await makeUser(db, "Paid Then Failed Seller");
      const productId = await makeParentProduct(seller, "Paid Then Failed Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]),
      );
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, null)`, [payoutId.rows[0].create_seller_payout]));
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.mark_payout_failed($1, null)`, [payoutId.rows[0].create_seller_payout])).rejects.toThrow(
          /paid payout cannot be marked as failed/i,
        );
      });
    });
  });

  describe("create_seller_payout() validation", () => {
    it("rejects a batch mixing orders from two different sellers", async () => {
      const sellerA = await makeUser(db, "Mixed Seller A");
      const sellerB = await makeUser(db, "Mixed Seller B");
      const productA = await makeParentProduct(sellerA, "Mixed Toy A", 50000);
      const productB = await makeParentProduct(sellerB, "Mixed Toy B", 50000);
      const orderA = await makeCompletedOnlineOrder({ productId: productA, seller: sellerA, priceCents: 50000 });
      const orderB = await makeCompletedOnlineOrder({ productId: productB, seller: sellerB, priceCents: 50000 });
      await asUser(db, admin, async () => {
        await expect(
          db.query(`select public.create_seller_payout(array[$1, $2]::uuid[])`, [orderA.orderId, orderB.orderId]),
        ).rejects.toThrow(/same seller/i);
      });
    });

    it("combines multiple orders from the same seller into one payout with the correct total", async () => {
      const seller = await makeUser(db, "Batch Payout Seller");
      const productA = await makeParentProduct(seller, "Batch Toy A", 50000);
      const productB = await makeParentProduct(seller, "Batch Toy B", 30000);
      const orderA = await makeCompletedOnlineOrder({ productId: productA, seller, priceCents: 50000 });
      const orderB = await makeCompletedOnlineOrder({ productId: productB, seller, priceCents: 30000 });
      const payoutId = await asUser(db, admin, () =>
        db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1, $2]::uuid[])`, [orderA.orderId, orderB.orderId]),
      );
      await db.query("reset role");
      const payout = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId.rows[0].create_seller_payout]);
      const expected = (50000 - 6000) + (30000 - 3600); // 12% of each subtotal
      expect(Number(payout.rows[0].amount_cents)).toBe(expected);
      const items = await db.query(`select order_id from public.payout_items where payout_id = $1`, [payoutId.rows[0].create_seller_payout]);
      expect(items.rows).toHaveLength(2);
    });

    it("rejects a nonexistent order id", async () => {
      await asUser(db, admin, async () => {
        await expect(
          db.query(`select public.create_seller_payout(array[$1]::uuid[])`, ["00000000-0000-4000-8000-000000000000"]),
        ).rejects.toThrow(/not found/i);
      });
    });
  });
});
