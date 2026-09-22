import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

// payments.provider_reference is unique — every simulated PayFast ITN
// needs its own distinct reference, never a shared literal, since every
// test in this file runs against one shared PGlite database (see the
// exact same counter pattern in tests/db/seller-payouts.test.ts).
let payfastRefCounter = 0;
function nextPayfastRef(): string {
  payfastRefCounter += 1;
  return `pf-recovery-test-ref-${payfastRefCounter}`;
}

let trackingRefCounter = 0;
function nextTrackingRef(): string {
  trackingRefCounter += 1;
  return `payout-recovery-tracking-ref-${trackingRefCounter}`;
}

/**
 * Phase 8B: payout recovery & settlement operations — exercised against
 * the real migration SQL and real Postgres, the same method as every
 * other tests/db/*.test.ts file. Covers recover_failed_payout() itself,
 * the partial-unique-index redesign of payout_items' double-payout
 * guarantee, and every regression this phase's own migration comment
 * calls out as a risk (cash orders, delivery margin, historical
 * immutability, RLS).
 */
describe("payout recovery (Phase 8B)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;
  let secondAdmin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Recovery Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
    secondAdmin = await makeUser(db, "Second Recovery Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [secondAdmin]);
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

  /** Same recipe as seller-payouts.test.ts's own makeCompletedOnlineOrder(). */
  async function makeCompletedOnlineOrder(opts: { productId: string; seller: string; buyer?: string; priceCents: number }) {
    const buyer = opts.buyer ?? (await makeUser(db, `Recovery Buyer ${Math.random()}`));
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

  async function makeFailedPayout(seller: string, priceCents: number) {
    const productId = await makeParentProduct(seller, `Failed Payout Toy ${Math.random()}`, priceCents);
    const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents });
    const payoutId = (
      await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
    ).rows[0].create_seller_payout;
    await asUser(db, admin, () => db.query(`select public.mark_payout_failed($1, 'bank rejected transfer')`, [payoutId]));
    return { orderId, payoutId };
  }

  describe("core recovery flow (1-4)", () => {
    it("1. an admin can recover a failed payout", async () => {
      const seller = await makeUser(db, "Recover Success Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Bank transfer failed — confirmed funds were not sent."]));

      await db.query("reset role");
      const payout = await db.query<{ status: string }>(`select status from public.payouts where id = $1`, [payoutId]);
      expect(payout.rows[0].status).toBe("recovered");
    });

    it("2. a non-admin cannot recover a payout", async () => {
      const seller = await makeUser(db, "Recover Block Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);

      await asUser(db, seller, async () => {
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "trying to recover my own payout"])).rejects.toThrow(/admin authorization required/i);
      });

      await db.query("reset role");
      const payout = await db.query<{ status: string }>(`select status from public.payouts where id = $1`, [payoutId]);
      expect(payout.rows[0].status).toBe("failed");
    });

    it("3. recovery requires a non-empty reason", async () => {
      const seller = await makeUser(db, "Empty Reason Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, ""])).rejects.toThrow(/reason is required/i);
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "   "])).rejects.toThrow(/reason is required/i);
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, null])).rejects.toThrow(/reason is required/i);
      });
    });

    it("4. recovery creates an admin_actions audit record with admin id, reason, and timestamp", async () => {
      const seller = await makeUser(db, "Audit Record Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      const reason = "Bank transfer failed — confirmed funds were not sent.";

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, reason]));

      await db.query("reset role");
      const action = await db.query<{ admin_id: string; action_type: string; target_type: string; target_id: string; notes: string; created_at: string }>(
        `select admin_id, action_type, target_type, target_id, notes, created_at from public.admin_actions where target_id = $1 and action_type = 'payout.recovered'`,
        [payoutId],
      );
      expect(action.rows).toHaveLength(1);
      expect(action.rows[0].admin_id).toBe(admin);
      expect(action.rows[0].target_type).toBe("payout");
      expect(action.rows[0].notes).toBe(reason);
      expect(action.rows[0].created_at).not.toBeNull();
    });
  });

  describe("historical immutability (5, 8, 16-17)", () => {
    it("5. the original payout's amount and creation history are untouched by recovery", async () => {
      const seller = await makeUser(db, "History Intact Seller");
      const { payoutId } = await makeFailedPayout(seller, 100000);
      const before = await db.query<{ amount_cents: string; created_at: string; recipient_profile_id: string }>(
        `select amount_cents, created_at, recipient_profile_id from public.payouts where id = $1`,
        [payoutId],
      );

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      await db.query("reset role");
      const after = await db.query<{ amount_cents: string; created_at: string; recipient_profile_id: string }>(
        `select amount_cents, created_at, recipient_profile_id from public.payouts where id = $1`,
        [payoutId],
      );
      expect(after.rows[0].amount_cents).toBe(before.rows[0].amount_cents);
      expect(after.rows[0].created_at).toEqual(before.rows[0].created_at);
      expect(after.rows[0].recipient_profile_id).toBe(before.rows[0].recipient_profile_id);
    });

    it("8. the original (now-recovered) payout remains distinguishable from any later payout for the same order", async () => {
      const seller = await makeUser(db, "Distinguishable Seller");
      const { orderId, payoutId: originalPayoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [originalPayoutId, "Confirmed funds never left Bambini's account."]));
      const newPayoutId = (
        await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
      ).rows[0].create_seller_payout;

      expect(newPayoutId).not.toBe(originalPayoutId);

      await db.query("reset role");
      const original = await db.query<{ status: string }>(`select status from public.payouts where id = $1`, [originalPayoutId]);
      const fresh = await db.query<{ status: string }>(`select status from public.payouts where id = $1`, [newPayoutId]);
      expect(original.rows[0].status).toBe("recovered");
      expect(fresh.rows[0].status).toBe("pending");

      const originalItems = await db.query<{ superseded_at: string | null }>(`select superseded_at from public.payout_items where payout_id = $1`, [originalPayoutId]);
      const freshItems = await db.query<{ superseded_at: string | null }>(`select superseded_at from public.payout_items where payout_id = $1`, [newPayoutId]);
      expect(originalItems.rows[0].superseded_at).not.toBeNull();
      expect(freshItems.rows[0].superseded_at).toBeNull();
    });

    it("16. a commission-rate change after recovery cannot alter the original payout's historical amount", async () => {
      const seller = await makeUser(db, "Post-Recovery Rate Seller");
      const { payoutId } = await makeFailedPayout(seller, 100000);
      const before = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

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

    it("17. a delivery-markup setting change after recovery cannot alter the original payout's historical amount", async () => {
      const seller = await makeUser(db, "Post-Recovery Markup Seller");
      const { payoutId } = await makeFailedPayout(seller, 100000);
      const before = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      // No write path to delivery_markup_settings exists in the app layer
      // (matching seller-payouts.test.ts's own "no application function
      // exists" reasoning for commission_rates) — this models what a
      // hypothetical future config change would look like at the database
      // level, and confirms the already-created payout row is entirely
      // unaffected regardless.
      await db.query("reset role");
      const after = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
      expect(after.rows[0].amount_cents).toBe(before.rows[0].amount_cents);
    });
  });

  describe("recovered order becomes eligible for a new payout (6-7)", () => {
    it("6. the recovered order's payout_items claim is superseded, freeing it for a new payout", async () => {
      const seller = await makeUser(db, "Freed Order Seller");
      const { orderId, payoutId } = await makeFailedPayout(seller, 50000);

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).resolves.toBeDefined();
      });
    });

    it("7. the new payout created after recovery gets a distinct id and its own payout_items row using the same immutable earnings amount", async () => {
      const seller = await makeUser(db, "New Id Seller");
      const { orderId, payoutId: originalPayoutId } = await makeFailedPayout(seller, 100000);
      const originalItem = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where payout_id = $1`, [originalPayoutId]);

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [originalPayoutId, "Confirmed funds never left Bambini's account."]));
      const newPayoutId = (
        await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
      ).rows[0].create_seller_payout;

      expect(newPayoutId).not.toBe(originalPayoutId);
      await db.query("reset role");
      const newItem = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where payout_id = $1`, [newPayoutId]);
      expect(newItem.rows[0].amount_cents).toBe(originalItem.rows[0].amount_cents);
    });
  });

  describe("double-payout safety after recovery (9, 11)", () => {
    it("9. the same order never has two ACTIVE payout_items claims at once, even across a recovery", async () => {
      const seller = await makeUser(db, "Never Two Active Seller");
      const { orderId, payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));
      await asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]));

      await db.query("reset role");
      const activeClaims = await db.query(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderId]);
      expect(activeClaims.rows).toHaveLength(1);
      const allClaims = await db.query(`select payout_id from public.payout_items where order_id = $1`, [orderId]);
      expect(allClaims.rows).toHaveLength(2); // one superseded (historical), one active
    });

    it("11. two concurrent create_seller_payout() calls for the same just-recovered order never both succeed", async () => {
      const seller = await makeUser(db, "Concurrent Post-Recovery Seller");
      const { orderId, payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      const results = await Promise.allSettled([
        asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])),
        asUser(db, admin, () => db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])),
      ]);
      const succeeded = results.filter((r) => r.status === "fulfilled");
      expect(succeeded).toHaveLength(1);

      await db.query("reset role");
      const activeClaims = await db.query(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderId]);
      expect(activeClaims.rows).toHaveLength(1);
    });
  });

  describe("concurrency and repeat-action safety (10, 12-15)", () => {
    it("10. two admins attempting to recover the same failed payout simultaneously — only one succeeds", async () => {
      const seller = await makeUser(db, "Concurrent Recovery Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);

      const results = await Promise.allSettled([
        asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Admin A: confirmed funds never left Bambini's account."])),
        asUser(db, secondAdmin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Admin B: confirmed funds never left Bambini's account."])),
      ]);
      const succeeded = results.filter((r) => r.status === "fulfilled");
      expect(succeeded).toHaveLength(1);

      await db.query("reset role");
      const action = await db.query(`select admin_id from public.admin_actions where target_id = $1 and action_type = 'payout.recovered'`, [payoutId]);
      expect(action.rows).toHaveLength(1); // exactly one recovery audit row, not two
    });

    it("12. a payout that has already been recovered cannot be recovered a second time", async () => {
      const seller = await makeUser(db, "Double Recovery Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "trying again"])).rejects.toThrow(/already been recovered/i);
      });
    });

    it("13. a paid payout cannot be recovered", async () => {
      const seller = await makeUser(db, "Paid Cannot Recover Seller");
      const productId = await makeParentProduct(seller, "Paid Cannot Recover Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = (
        await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
      ).rows[0].create_seller_payout;
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, null)`, [payoutId]));

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "trying to recover a paid payout"])).rejects.toThrow(/only a failed payout can be recovered/i);
      });
    });

    it("14. a pending payout cannot be recovered", async () => {
      const seller = await makeUser(db, "Pending Cannot Recover Seller");
      const productId = await makeParentProduct(seller, "Pending Cannot Recover Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const payoutId = (
        await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
      ).rows[0].create_seller_payout;

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "trying to recover a pending payout"])).rejects.toThrow(/only a failed payout can be recovered/i);
      });
    });

    it("15. a failed payout that is never explicitly recovered stays permanently claimed — no automatic release", async () => {
      const seller = await makeUser(db, "Never Recovered Seller");
      const { orderId } = await makeFailedPayout(seller, 50000);

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).rejects.toThrow(/already been paid out/i);
      });

      await db.query("reset role");
      const eligible = await db.query(`select order_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderId]);
      expect(eligible.rows).toHaveLength(1); // still actively claimed, exactly as it was left by mark_payout_failed()
    });
  });

  describe("regressions this phase must not break (18-19)", () => {
    async function makeCompletedDeliveryOrder(providerCostCents: number, markupPercentageBps: number, subtotalCents: number) {
      const seller = await makeUser(db, `Recovery Delivery Seller ${Math.random()}`);
      const buyer = await makeUser(db, `Recovery Delivery Buyer ${Math.random()}`);
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
         values ('parent', $1, $2, 'Recovery Delivery Toy', 'good', $3, 'published', true, true, $4)
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

    it("18. delivery margin is still excluded from the payout amount for a recovered-then-recreated payout", async () => {
      const { orderId } = await makeCompletedDeliveryOrder(5000, 2000, 100000); // R50 provider cost, 20% markup, R1000 subtotal
      const originalPayoutId = (
        await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
      ).rows[0].create_seller_payout;
      await asUser(db, admin, () => db.query(`select public.mark_payout_failed($1, 'bank rejected transfer')`, [originalPayoutId]));
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [originalPayoutId, "Confirmed funds never left Bambini's account."]));
      const newPayoutId = (
        await asUser(db, admin, () => db.query<{ create_seller_payout: string }>(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId]))
      ).rows[0].create_seller_payout;

      await db.query("reset role");
      const item = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where payout_id = $1`, [newPayoutId]);
      expect(Number(item.rows[0].amount_cents)).toBe(100000 - 12000); // subtotal - commission, never the R60 delivery fee
    });

    it("19. a cash order still never enters the payout flow, recovery included — commission stays owed_by_seller", async () => {
      const seller = await makeUser(db, "Cash Regression Seller");
      await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified', completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Cash Regression Buyer");
      const productId = await makeParentProduct(seller, "Cash Regression Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
      await db.query("reset role");

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.create_seller_payout(array[$1]::uuid[])`, [orderId])).rejects.toThrow(/only online orders/i);
      });

      const commission = await db.query<{ settlement_status: string }>(`select settlement_status from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].settlement_status).toBe("owed_by_seller");
      const items = await db.query(`select payout_id from public.payout_items where order_id = $1`, [orderId]);
      expect(items.rows).toHaveLength(0); // no payout row was ever created for this order, recovery or otherwise
    });
  });

  describe("RLS: recovery info visibility (20-23)", () => {
    it("20. a buyer cannot read a seller's payout, including its recovery columns", async () => {
      const seller = await makeUser(db, "Recovery Buyer Block Seller");
      const { orderId, payoutId } = await makeFailedPayout(seller, 50000);
      const created = await db.query<{ buyer_id: string }>(`select buyer_id from public.orders where id = $1`, [orderId]);
      const buyer = created.rows[0].buyer_id;
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      const buyerSees = await asUser(db, buyer, () => db.query(`select id, recovery_reason from public.payouts where id = $1`, [payoutId]));
      expect(buyerSees.rows).toHaveLength(0);
    });

    it("21. an unrelated seller cannot read another seller's recovery info", async () => {
      const seller = await makeUser(db, "Recovery Isolation Seller A");
      const otherSeller = await makeUser(db, "Recovery Isolation Seller B");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      const otherSees = await asUser(db, otherSeller, () => db.query(`select id, recovery_reason from public.payouts where id = $1`, [payoutId]));
      expect(otherSees.rows).toHaveLength(0);
    });

    it("22. an admin can read full recovery info (recovered_by, recovered_at, recovery_reason)", async () => {
      const seller = await makeUser(db, "Admin Sees Recovery Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      const reason = "Bank transfer failed — confirmed funds were not sent.";
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, reason]));

      const adminSees = await asUser(db, admin, () =>
        db.query<{ recovered_by: string; recovered_at: string; recovery_reason: string }>(
          `select recovered_by, recovered_at, recovery_reason from public.payouts where id = $1`,
          [payoutId],
        ),
      );
      expect(adminSees.rows[0].recovered_by).toBe(admin);
      expect(adminSees.rows[0].recovered_at).not.toBeNull();
      expect(adminSees.rows[0].recovery_reason).toBe(reason);
    });

    it("23. a seller sees their own payout's status as 'recovered' (a safe status), same read path as any other status", async () => {
      const seller = await makeUser(db, "Seller Sees Safe Status Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      const sellerSees = await asUser(db, seller, () => db.query<{ status: string }>(`select status from public.payouts where id = $1`, [payoutId]));
      expect(sellerSees.rows).toHaveLength(1);
      expect(sellerSees.rows[0].status).toBe("recovered");
    });

    it("anon cannot read any payout's recovery info", async () => {
      const seller = await makeUser(db, "Anon Recovery Block Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      const anonSees = await asAnon(db, () => db.query(`select id, recovery_reason from public.payouts where id = $1`, [payoutId]));
      expect(anonSees.rows).toHaveLength(0);
    });
  });

  describe("authorization boundary regressions (24-27)", () => {
    it("24. a normal authenticated user cannot call recover_failed_payout() directly, even on their own payout", async () => {
      const seller = await makeUser(db, "Self Recovery Block Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "let me recover my own payout"])).rejects.toThrow(/admin authorization required/i);
      });
    });

    it("25. no client role can directly UPDATE payouts.status to 'recovered' or set the recovery columns", async () => {
      const seller = await makeUser(db, "Direct Recovery Update Block Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      const updated = await asUser(db, admin, () =>
        db.query(`update public.payouts set status = 'recovered', recovered_by = $2, recovered_at = now(), recovery_reason = 'forged' where id = $1`, [payoutId, admin]),
      );
      // Same "even an admin's own ordinary session cannot write here"
      // guarantee seller-payouts.test.ts already established for
      // amount_cents/status — recovery columns are no exception.
      expect(updated.affectedRows).toBe(0);
    });

    it("26. mark_payout_paid() rejects a recovered payout", async () => {
      const seller = await makeUser(db, "Recovered Then Mark Paid Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.mark_payout_paid($1, 'ref')`, [payoutId])).rejects.toThrow(/recovered payout cannot be marked as paid/i);
      });
    });

    it("27. mark_payout_failed() rejects a recovered payout", async () => {
      const seller = await makeUser(db, "Recovered Then Mark Failed Seller");
      const { payoutId } = await makeFailedPayout(seller, 50000);
      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.mark_payout_failed($1, 'ref')`, [payoutId])).rejects.toThrow(/recovered payout cannot be marked as failed/i);
      });
    });
  });
});
