import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 4C: cash-on-collection + collection confirmation (both payment
 * methods), exercised against the real migration SQL and real Postgres,
 * the same method as every other tests/db/*.test.ts file. Covers
 * create_order()'s new p_payment_method branch,
 * accept_cash_order()/decline_cash_order()/confirm_collection()/
 * get_my_collection_code(), the collection-code column-privacy fix, and
 * the commission settlement_status semantics.
 */
describe("cash collection transactions", () => {
  let db: PGlite;
  let categoryId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  // Always restore the global switch — a few tests flip it off.
  afterEach(async () => {
    await db.query("reset role");
    await db.query(`update public.cash_settings set is_enabled = true where id = true`);
  });

  async function makeProduct(
    seller: string,
    title: string,
    overrides: { status?: "draft" | "published" | "archived"; price_cents?: number; collection_available?: boolean; delivery_available?: boolean } = {},
  ) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, $3, 'good', $4, $5, $6, $7)
       returning id`,
      [
        seller,
        categoryId,
        title,
        overrides.price_cents ?? 50000,
        overrides.status ?? "published",
        overrides.collection_available ?? true,
        overrides.delivery_available ?? true,
      ],
    );
    return r.rows[0].id;
  }

  /** A seller who satisfies every seeded cash_eligibility_criteria row. */
  async function makeEligibleSeller(name: string): Promise<string> {
    const id = await makeUser(db, name);
    await db.query(
      `update public.profiles set account_verification = 'verified', identity_verification = 'verified',
         completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good'
       where id = $1`,
      [id],
    );
    return id;
  }

  async function createCashOrder(buyer: string, productId: string) {
    return asUser(db, buyer, () =>
      db.query<{ order_id: string; order_reference: string }>(
        `select * from public.create_order($1, 'collection', 'cash')`,
        [productId],
      ),
    );
  }

  describe("cash + delivery is impossible", () => {
    it("1. create_order() rejects cash + delivery at the database level, regardless of what the client sends", async () => {
      const seller = await makeEligibleSeller("Delivery Reject Seller");
      const buyer = await makeUser(db, "Delivery Reject Buyer");
      const productId = await makeProduct(seller, "Delivery Reject Toy");
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'cash')`, [productId]),
        ).rejects.toThrow(/not available for delivery/i);
      });
      // The product must not have been claimed by the rejected attempt.
      await db.query("reset role");
      const product = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(product.rows[0].status).toBe("published");
    });

    it("2. the orders table itself rejects the combination via a CHECK constraint (defense in depth)", async () => {
      const seller = await makeEligibleSeller("Check Constraint Seller");
      const buyer = await makeUser(db, "Check Constraint Buyer");
      await expect(
        db.query(
          `insert into public.orders (buyer_id, seller_type, seller_profile_id, fulfilment_type, payment_method, subtotal_cents, total_cents, commission_rate_bps, commission_amount_cents)
           values ($1, 'parent', $2, 'delivery', 'cash', 10000, 10000, 1200, 1200)`,
          [buyer, seller],
        ),
      ).rejects.toThrow(/orders_cash_requires_collection/i);
    });

    it("3. online + delivery still works exactly as before (regression)", async () => {
      const seller = await makeUser(db, "Online Delivery Seller");
      const buyer = await makeUser(db, "Online Delivery Buyer");
      await db.query(
        `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, -33.9, 18.4, 'Gardens', 'Cape Town')`,
        [buyer],
      );
      const loc = await db.query<{ id: string }>(`select id from public.locations where created_by = $1`, [buyer]);
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [loc.rows[0].id, buyer]);
      const productId = await makeProduct(seller, "Online Delivery Toy");
      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online')`, [productId]),
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  describe("seller cash eligibility (evaluated fresh, never trusted from seller_cash_status)", () => {
    it("4. an eligible seller can create a cash collection order", async () => {
      const seller = await makeEligibleSeller("Eligible Seller A");
      const buyer = await makeUser(db, "Eligible Buyer A");
      const productId = await makeProduct(seller, "Eligible Toy A");
      const r = await createCashOrder(buyer, productId);
      expect(r.rows).toHaveLength(1);
    });

    it("5. a brand-new (default, unverified) seller cannot — new sellers do not get automatic cash privileges", async () => {
      const seller = await makeUser(db, "Fresh Seller");
      const buyer = await makeUser(db, "Fresh Buyer");
      const productId = await makeProduct(seller, "Fresh Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("6. insufficient completed transactions fails eligibility", async () => {
      const seller = await makeEligibleSeller("Low Transactions Seller");
      await db.query(`update public.profiles set completed_transaction_count = 1 where id = $1`, [seller]);
      const buyer = await makeUser(db, "Low Transactions Buyer");
      const productId = await makeProduct(seller, "Low Transactions Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("7. insufficient rating fails eligibility", async () => {
      const seller = await makeEligibleSeller("Low Rating Seller");
      await db.query(`update public.profiles set rating_average = 2.0 where id = $1`, [seller]);
      const buyer = await makeUser(db, "Low Rating Buyer");
      const productId = await makeProduct(seller, "Low Rating Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("8. missing account verification fails eligibility", async () => {
      const seller = await makeEligibleSeller("Unverified Account Seller");
      // Phase 5: account verification is derived live from auth.users, not
      // the (now-inert) profiles.account_verification column — see
      // 20260928090000_identity_account_verification.sql.
      await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [seller]);
      const buyer = await makeUser(db, "Unverified Account Buyer");
      const productId = await makeProduct(seller, "Unverified Account Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("9. missing identity verification fails eligibility", async () => {
      const seller = await makeEligibleSeller("Unverified Identity Seller");
      await db.query(`update public.profiles set identity_verification = 'unverified' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Unverified Identity Buyer");
      const productId = await makeProduct(seller, "Unverified Identity Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("10. an unresolved dispute against the seller fails eligibility", async () => {
      const seller = await makeEligibleSeller("Disputed Seller");
      const buyer = await makeUser(db, "Disputed Buyer");

      // A prior (unrelated) completed order to attach the dispute to.
      const priorOrder = await db.query<{ id: string }>(
        `insert into public.orders (buyer_id, seller_type, seller_profile_id, fulfilment_type, payment_method, status, subtotal_cents, total_cents, commission_rate_bps, commission_amount_cents)
         values ($1, 'parent', $2, 'collection', 'online', 'completed', 10000, 10000, 1200, 1200) returning id`,
        [buyer, seller],
      );
      await db.query(`insert into public.disputes (order_id, raised_by, reason, status) values ($1, $2, 'Item not as described', 'open')`, [
        priorOrder.rows[0].id,
        buyer,
      ]);

      const productId = await makeProduct(seller, "Disputed Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("11. a suspended account fails eligibility regardless of every other criterion", async () => {
      const seller = await makeEligibleSeller("Suspended Seller");
      await db.query(`update public.profiles set account_standing = 'suspended' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Suspended Buyer");
      const productId = await makeProduct(seller, "Suspended Toy");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("12. eligibility is evaluated fresh at order creation, not trusted from a stale seller_cash_status row", async () => {
      const seller = await makeEligibleSeller("Stale Snapshot Seller");
      // Plant a stale, incorrect snapshot claiming ineligibility.
      await db.query(
        `insert into public.seller_cash_status (seller_type, seller_profile_id, is_eligible, failed_criteria) values ('parent', $1, false, array['stale'])`,
        [seller],
      );
      const buyer = await makeUser(db, "Stale Snapshot Buyer");
      const productId = await makeProduct(seller, "Stale Snapshot Toy");
      // The seller is actually eligible right now — order creation must
      // succeed based on a fresh evaluation, not the stale false row.
      const r = await createCashOrder(buyer, productId);
      expect(r.rows).toHaveLength(1);
    });

    it("13. is_seller_cash_eligible() returns a plain boolean, never failed_criteria, and matches create_order()'s own decision", async () => {
      const seller = await makeEligibleSeller("Boolean Wrapper Seller");
      const ineligible = await makeUser(db, "Boolean Wrapper Ineligible");
      const buyer = await makeUser(db, "Boolean Wrapper Buyer");

      const eligibleCheck = await asUser(db, buyer, () =>
        db.query<{ is_seller_cash_eligible: boolean }>(`select public.is_seller_cash_eligible('parent', $1, null)`, [seller]),
      );
      expect(eligibleCheck.rows[0].is_seller_cash_eligible).toBe(true);

      const ineligibleCheck = await asUser(db, buyer, () =>
        db.query<{ is_seller_cash_eligible: boolean }>(`select public.is_seller_cash_eligible('parent', $1, null)`, [ineligible]),
      );
      expect(ineligibleCheck.rows[0].is_seller_cash_eligible).toBe(false);

      // Only a boolean column comes back — no failed_criteria leak.
      expect(Object.keys(eligibleCheck.rows[0])).toEqual(["is_seller_cash_eligible"]);
    });

    it("14. anonymous cannot call is_seller_cash_eligible()", async () => {
      const seller = await makeEligibleSeller("Anon Eligibility Seller");
      await asAnon(db, async () => {
        await expect(db.query(`select public.is_seller_cash_eligible('parent', $1, null)`, [seller])).rejects.toThrow();
      });
    });
  });

  describe("global cash kill-switch", () => {
    it("15. cash order creation fails outright while cash is globally disabled, even for an eligible seller", async () => {
      const seller = await makeEligibleSeller("Kill Switch Seller");
      const buyer = await makeUser(db, "Kill Switch Buyer");
      const productId = await makeProduct(seller, "Kill Switch Toy");

      await db.query(`update public.cash_settings set is_enabled = false where id = true`);

      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /currently unavailable/i,
        );
      });
    });

    it("16. online orders are completely unaffected by the cash kill-switch", async () => {
      const seller = await makeUser(db, "Kill Switch Online Seller");
      const buyer = await makeUser(db, "Kill Switch Online Buyer");
      const productId = await makeProduct(seller, "Kill Switch Online Toy");

      await db.query(`update public.cash_settings set is_enabled = false where id = true`);

      const r = await asUser(db, buyer, () => db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
      expect(r.rows).toHaveLength(1);
    });

    it("17. re-enabling cash immediately restores cash order creation", async () => {
      const seller = await makeEligibleSeller("Kill Switch Restore Seller");
      const buyer = await makeUser(db, "Kill Switch Restore Buyer");
      const productId = await makeProduct(seller, "Kill Switch Restore Toy");

      await db.query(`update public.cash_settings set is_enabled = false where id = true`);
      await db.query(`update public.cash_settings set is_enabled = true where id = true`);

      const r = await createCashOrder(buyer, productId);
      expect(r.rows).toHaveLength(1);
    });
  });

  describe("cash order creation shape", () => {
    it("18. cash payment row has method=cash, provider_id=NULL, status=pending", async () => {
      const seller = await makeEligibleSeller("Shape Seller A");
      const buyer = await makeUser(db, "Shape Buyer A");
      const productId = await makeProduct(seller, "Shape Toy A", { price_cents: 50000 });
      const created = await createCashOrder(buyer, productId);
      await db.query("reset role");
      const payment = await db.query<{ method: string; provider_id: string | null; status: string; amount_cents: string }>(
        `select method, provider_id, status, amount_cents from public.payments where order_id = $1`,
        [created.rows[0].order_id],
      );
      expect(payment.rows[0].method).toBe("cash");
      expect(payment.rows[0].provider_id).toBeNull();
      expect(payment.rows[0].status).toBe("pending");
      expect(Number(payment.rows[0].amount_cents)).toBe(50000);
    });

    it("19. cash commission is recorded as owed_by_seller, never collected_via_payment", async () => {
      const seller = await makeEligibleSeller("Shape Seller B");
      const buyer = await makeUser(db, "Shape Buyer B");
      const productId = await makeProduct(seller, "Shape Toy B", { price_cents: 50000 });
      const created = await createCashOrder(buyer, productId);
      await db.query("reset role");
      const commission = await db.query<{ settlement_status: string; commission_amount_cents: string }>(
        `select settlement_status, commission_amount_cents from public.commissions where order_id = $1`,
        [created.rows[0].order_id],
      );
      expect(commission.rows[0].settlement_status).toBe("owed_by_seller");
      expect(Number(commission.rows[0].commission_amount_cents)).toBe(6000); // 12% of R500
    });

    it("20. online commission is recorded as collected_via_payment (regression)", async () => {
      const seller = await makeUser(db, "Shape Seller C");
      const buyer = await makeUser(db, "Shape Buyer C");
      const productId = await makeProduct(seller, "Shape Toy C", { price_cents: 50000 });
      const created = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]),
      );
      await db.query("reset role");
      const commission = await db.query<{ settlement_status: string }>(`select settlement_status from public.commissions where order_id = $1`, [
        created.rows[0].order_id,
      ]);
      expect(commission.rows[0].settlement_status).toBe("collected_via_payment");
    });

    it("21. a collection_confirmations row (with a real code) is created for the cash order", async () => {
      const seller = await makeEligibleSeller("Shape Seller D");
      const buyer = await makeUser(db, "Shape Buyer D");
      const productId = await makeProduct(seller, "Shape Toy D");
      const created = await createCashOrder(buyer, productId);
      await db.query("reset role");
      const cc = await db.query<{ collection_code: string; failed_attempts: number }>(
        `select collection_code, failed_attempts from public.collection_confirmations where order_id = $1`,
        [created.rows[0].order_id],
      );
      expect(cc.rows).toHaveLength(1);
      expect(cc.rows[0].collection_code).toMatch(/^\d{6}$/);
      expect(cc.rows[0].failed_attempts).toBe(0);
    });

    it("22. a collection_confirmations row is also created for an ONLINE collection order (closes the Phase 4B gap)", async () => {
      const seller = await makeUser(db, "Shape Seller E");
      const buyer = await makeUser(db, "Shape Buyer E");
      const productId = await makeProduct(seller, "Shape Toy E");
      const created = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]),
      );
      await db.query("reset role");
      const cc = await db.query(`select id from public.collection_confirmations where order_id = $1`, [created.rows[0].order_id]);
      expect(cc.rows).toHaveLength(1);
    });

    it("23. no collection_confirmations row is created for a delivery order", async () => {
      const seller = await makeUser(db, "Shape Seller F");
      const buyer = await makeUser(db, "Shape Buyer F");
      await db.query(`insert into public.locations (created_by, latitude, longitude) values ($1, -33.9, 18.4)`, [buyer]);
      const loc = await db.query<{ id: string }>(`select id from public.locations where created_by = $1`, [buyer]);
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [loc.rows[0].id, buyer]);
      const productId = await makeProduct(seller, "Shape Toy F");
      const created = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online')`, [productId]),
      );
      await db.query("reset role");
      const cc = await db.query(`select id from public.collection_confirmations where order_id = $1`, [created.rows[0].order_id]);
      expect(cc.rows).toHaveLength(0);
    });

    it("24. collection codes generated across many orders are all distinct 6-digit numeric strings", async () => {
      const seller = await makeEligibleSeller("Uniqueness Seller");
      const codes = new Set<string>();
      for (let i = 0; i < 15; i++) {
        const buyer = await makeUser(db, `Uniqueness Buyer ${i}`);
        const productId = await makeProduct(seller, `Uniqueness Toy ${i}`);
        const created = await createCashOrder(buyer, productId);
        await db.query("reset role");
        const cc = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [
          created.rows[0].order_id,
        ]);
        expect(cc.rows[0].collection_code).toMatch(/^\d{6}$/);
        codes.add(cc.rows[0].collection_code);
      }
      expect(codes.size).toBe(15);
    });

    it("25. create_order() takes no cash-specific price/commission override parameters", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      const argNames = r.rows[0].proargnames;
      for (const forbidden of ["price_cents", "commission_amount_cents", "settlement_status", "is_eligible"]) {
        expect(argNames).not.toContain(forbidden);
      }
      // proargnames also includes the RETURNS TABLE output columns
      // (order_id, order_reference) as implicit OUT parameters.
      expect(argNames).toEqual(["p_product_id", "p_fulfilment_type", "p_payment_method", "order_id", "order_reference"]);
    });
  });

  describe("seller acceptance of a pending cash order", () => {
    async function setup(name: string) {
      const seller = await makeEligibleSeller(`Accept Seller ${name}`);
      const buyer = await makeUser(db, `Accept Buyer ${name}`);
      const unrelated = await makeUser(db, `Accept Unrelated ${name}`);
      const productId = await makeProduct(seller, `Accept Toy ${name}`);
      const created = await createCashOrder(buyer, productId);
      return { seller, buyer, unrelated, orderId: created.rows[0].order_id };
    }

    it("26. the eligible seller can accept — pending_payment -> confirmed, payment stays pending", async () => {
      const { seller, orderId } = await setup("A");
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("confirmed");
      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [orderId]);
      expect(payment.rows[0].status).toBe("pending");
    });

    it("27. accepting records a cash_order.accepted transaction event", async () => {
      const { seller, orderId } = await setup("B");
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const events = await db.query<{ event_type: string }>(`select event_type from public.transaction_events where order_id = $1 order by created_at`, [
        orderId,
      ]);
      expect(events.rows.map((e) => e.event_type)).toContain("cash_order.accepted");
    });

    it("28. an unrelated user cannot accept someone else's cash order", async () => {
      const { unrelated, orderId } = await setup("C");
      await asUser(db, unrelated, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow(/not found/i);
      });
    });

    it("29. the buyer cannot accept their own cash order", async () => {
      const { buyer, orderId } = await setup("D");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow(/not found/i);
      });
    });

    it("30. an online order cannot be accepted through accept_cash_order()", async () => {
      const seller = await makeUser(db, "Accept Wrong Method Seller");
      const buyer = await makeUser(db, "Accept Wrong Method Buyer");
      const productId = await makeProduct(seller, "Accept Wrong Method Toy");
      const created = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]),
      );
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [created.rows[0].order_id])).rejects.toThrow(/not found/i);
      });
    });

    it("31. cannot accept an order that isn't pending_payment (already accepted)", async () => {
      const { seller, orderId } = await setup("E");
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow(/not awaiting acceptance/i);
      });
    });

    it("32. accepting fails if the seller has since become ineligible (re-evaluated fresh, not trusted from order creation)", async () => {
      const { seller, orderId } = await setup("F");
      await db.query(`update public.profiles set account_standing = 'suspended' where id = $1`, [seller]);
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow(/no longer eligible/i);
      });
    });

    it("33. accepting fails while cash is globally disabled, even for an already-created order", async () => {
      const { seller, orderId } = await setup("G");
      await db.query(`update public.cash_settings set is_enabled = false where id = true`);
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow(/currently unavailable/i);
      });
    });

    it("34. anonymous cannot accept a cash order", async () => {
      const { orderId } = await setup("H");
      await asAnon(db, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow();
      });
    });
  });

  describe("seller decline of a pending cash order", () => {
    async function setup(name: string) {
      const seller = await makeEligibleSeller(`Decline Seller ${name}`);
      const buyer = await makeUser(db, `Decline Buyer ${name}`);
      const productId = await makeProduct(seller, `Decline Toy ${name}`);
      const created = await createCashOrder(buyer, productId);
      return { seller, buyer, productId, orderId: created.rows[0].order_id };
    }

    it("35. the seller can decline — pending_payment -> cancelled", async () => {
      const { seller, orderId } = await setup("A");
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1, $2)`, [orderId, "Changed my mind"]));
      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("cancelled");
    });

    it("36. declining releases the listing back to published", async () => {
      const { seller, productId, orderId } = await setup("B");
      await db.query("reset role");
      const before = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(before.rows[0].status).toBe("sold");
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const after = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(after.rows[0].status).toBe("published");
    });

    it("37. declining voids the commission obligation — never left as owed_by_seller, never falsely collected_via_payment", async () => {
      const { seller, orderId } = await setup("C");
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const commission = await db.query<{ settlement_status: string }>(`select settlement_status from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].settlement_status).toBe("settled");
      expect(commission.rows[0].settlement_status).not.toBe("collected_via_payment");
    });

    it("38. declining records a cash_order.declined transaction event", async () => {
      const { seller, orderId } = await setup("D");
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1, $2)`, [orderId, "No stock"]));
      await db.query("reset role");
      const events = await db.query<{ event_type: string }>(`select event_type from public.transaction_events where order_id = $1`, [orderId]);
      expect(events.rows.map((e) => e.event_type)).toContain("cash_order.declined");
    });

    it("39. an unrelated user cannot decline someone else's cash order", async () => {
      const { orderId } = await setup("E");
      const stranger = await makeUser(db, "Decline Stranger");
      await asUser(db, stranger, async () => {
        await expect(db.query(`select public.decline_cash_order($1)`, [orderId])).rejects.toThrow(/not found/i);
      });
    });

    it("40. cannot decline an order that isn't pending_payment", async () => {
      const { seller, orderId } = await setup("F");
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.decline_cash_order($1)`, [orderId])).rejects.toThrow(/cannot be declined/i);
      });
    });

    it("41. a duplicate decline is rejected cleanly, not silently double-applied", async () => {
      const { seller, orderId } = await setup("G");
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1)`, [orderId]));
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.decline_cash_order($1)`, [orderId])).rejects.toThrow(/cannot be declined/i);
      });
    });
  });

  describe("collection code confirmation", () => {
    async function setupConfirmed(name: string, opts: { method?: "cash" | "online" } = {}) {
      const method = opts.method ?? "cash";
      const seller = method === "cash" ? await makeEligibleSeller(`Confirm Seller ${name}`) : await makeUser(db, `Confirm Seller ${name}`);
      const buyer = await makeUser(db, `Confirm Buyer ${name}`);
      const productId = await makeProduct(seller, `Confirm Toy ${name}`, { price_cents: 50000 });
      const created = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', $2)`, [productId, method]),
      );
      const orderId = created.rows[0].order_id;

      if (method === "cash") {
        await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      } else {
        // Simulate a successful PayFast webhook the way
        // process_payfast_itn() would (service-role, not user-triggered).
        await db.query("reset role");
        await db.query(`select public.process_payfast_itn($1, 'pf-test-ref', 'paid', 50000)`, [orderId]);
      }

      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      return { seller, buyer, orderId, code: code.rows[0].collection_code };
    }

    it("42. the correct code (cash) completes the order, flips payment to paid, keeps commission owed_by_seller", async () => {
      const { seller, orderId, code } = await setupConfirmed("A");
      const r = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code]));
      expect(r.rows[0].outcome).toBe("completed");

      await db.query("reset role");
      const order = await db.query<{ status: string; completed_at: string | null }>(`select status, completed_at from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed");
      expect(order.rows[0].completed_at).not.toBeNull();
      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [orderId]);
      expect(payment.rows[0].status).toBe("paid");
      const commission = await db.query<{ settlement_status: string }>(`select settlement_status from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].settlement_status).toBe("owed_by_seller");
    });

    it("43. the correct code (online) completes the order, payment stays paid, commission stays collected_via_payment", async () => {
      const { seller, orderId, code } = await setupConfirmed("B", { method: "online" });

      await db.query("reset role");
      const before = await db.query<{ status: string; payment_status: string }>(
        `select o.status, p.status as payment_status from public.orders o join public.payments p on p.order_id = o.id where o.id = $1`,
        [orderId],
      );
      expect(before.rows[0].status).toBe("confirmed");
      expect(before.rows[0].payment_status).toBe("paid");

      const r = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code]));
      expect(r.rows[0].outcome).toBe("completed");

      await db.query("reset role");
      const after = await db.query<{ status: string; payment_status: string }>(
        `select o.status, p.status as payment_status from public.orders o join public.payments p on p.order_id = o.id where o.id = $1`,
        [orderId],
      );
      expect(after.rows[0].status).toBe("completed");
      expect(after.rows[0].payment_status).toBe("paid");
      const commission = await db.query<{ settlement_status: string }>(`select settlement_status from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].settlement_status).toBe("collected_via_payment");
    });

    it("44. an incorrect code is rejected without throwing and increments failed_attempts", async () => {
      const { seller, orderId } = await setupConfirmed("C");
      const r = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, "000000"]));
      expect(r.rows[0].outcome).toBe("incorrect_code");
      await db.query("reset role");
      const cc = await db.query<{ failed_attempts: number }>(`select failed_attempts from public.collection_confirmations where order_id = $1`, [orderId]);
      expect(cc.rows[0].failed_attempts).toBe(1);
    });

    it("45. 5 failed attempts locks confirmation, and the 6th (even with the correct code) is rejected as locked", async () => {
      const { seller, orderId, code } = await setupConfirmed("D");
      for (let i = 0; i < 5; i++) {
        const r = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, "111111"]));
        expect(["incorrect_code", "locked"]).toContain(r.rows[0].outcome);
      }
      const sixth = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code]));
      expect(sixth.rows[0].outcome).toBe("locked");

      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("confirmed"); // never completed
    });

    it("46. failed attempts record collection.attempt_failed transaction events", async () => {
      const { seller, orderId } = await setupConfirmed("E");
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, "222222"]));
      await db.query("reset role");
      const events = await db.query<{ event_type: string }>(`select event_type from public.transaction_events where order_id = $1`, [orderId]);
      expect(events.rows.map((e) => e.event_type)).toContain("collection.attempt_failed");
    });

    it("47. an unrelated user cannot call confirm_collection on someone else's order", async () => {
      const { orderId, code } = await setupConfirmed("F");
      const stranger = await makeUser(db, "Confirm Stranger");
      await asUser(db, stranger, async () => {
        await expect(db.query(`select public.confirm_collection($1, $2)`, [orderId, code])).rejects.toThrow(/not found/i);
      });
    });

    it("48. the buyer cannot call confirm_collection on their own order", async () => {
      const { buyer, orderId, code } = await setupConfirmed("G");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.confirm_collection($1, $2)`, [orderId, code])).rejects.toThrow(/not found/i);
      });
    });

    it("49. confirm_collection cannot be called before the seller has accepted (still pending_payment)", async () => {
      const seller = await makeEligibleSeller("Too Early Seller");
      const buyer = await makeUser(db, "Too Early Buyer");
      const productId = await makeProduct(seller, "Too Early Toy");
      const created = await createCashOrder(buyer, productId);
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [
        created.rows[0].order_id,
      ]);
      await asUser(db, seller, async () => {
        await expect(
          db.query(`select public.confirm_collection($1, $2)`, [created.rows[0].order_id, code.rows[0].collection_code]),
        ).rejects.toThrow(/not ready for collection confirmation/i);
      });
    });

    it("50. an already-completed order returns 'already_completed' and never regresses — repeat confirmation is idempotent", async () => {
      const { seller, orderId, code } = await setupConfirmed("H");
      const first = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code]));
      expect(first.rows[0].outcome).toBe("completed");

      const second = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code]));
      expect(second.rows[0].outcome).toBe("already_completed");

      // Even a wrong code on an already-completed order is a safe no-op,
      // not an error and not a fresh failed attempt.
      const third = await asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, "999999"]));
      expect(third.rows[0].outcome).toBe("already_completed");

      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed");
    });

    it("51. a cancelled order cannot be completed via confirm_collection", async () => {
      const seller = await makeEligibleSeller("Cancelled Then Confirm Seller");
      const buyer = await makeUser(db, "Cancelled Then Confirm Buyer");
      const productId = await makeProduct(seller, "Cancelled Then Confirm Toy");
      const created = await createCashOrder(buyer, productId);
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [
        created.rows[0].order_id,
      ]);
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1)`, [created.rows[0].order_id]));
      await asUser(db, seller, async () => {
        await expect(
          db.query(`select public.confirm_collection($1, $2)`, [created.rows[0].order_id, code.rows[0].collection_code]),
        ).rejects.toThrow(/not ready for collection confirmation/i);
      });
    });

    it("52. completing a cash order increments the seller's completed_transaction_count (existing trigger fires as before)", async () => {
      const { seller, orderId, code } = await setupConfirmed("I");
      await db.query("reset role");
      const before = await db.query<{ completed_transaction_count: number }>(`select completed_transaction_count from public.profiles where id = $1`, [seller]);
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code]));
      await db.query("reset role");
      const after = await db.query<{ completed_transaction_count: number }>(`select completed_transaction_count from public.profiles where id = $1`, [seller]);
      expect(after.rows[0].completed_transaction_count).toBe(before.rows[0].completed_transaction_count + 1);
    });

    it("53. concurrent confirm_collection calls on the same order never double-complete or corrupt state", async () => {
      const { seller, orderId, code } = await setupConfirmed("J");
      const results = await Promise.allSettled([
        asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code])),
        asUser(db, seller, () => db.query<{ outcome: string }>(`select * from public.confirm_collection($1, $2)`, [orderId, code])),
      ]);
      const outcomes = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<{ rows: { outcome: string }[] }>).value.rows[0].outcome);
      expect(outcomes.filter((o) => o === "completed")).toHaveLength(1);

      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed");
      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [orderId]);
      expect(payment.rows[0].status).toBe("paid");
    });

    it("54. anonymous cannot call confirm_collection", async () => {
      const { orderId, code } = await setupConfirmed("K");
      await asAnon(db, async () => {
        await expect(db.query(`select public.confirm_collection($1, $2)`, [orderId, code])).rejects.toThrow();
      });
    });
  });

  describe("get_my_collection_code()", () => {
    it("55. buyer can retrieve their own code and it matches the stored value exactly", async () => {
      const seller = await makeEligibleSeller("Code Retrieval Seller");
      const buyer = await makeUser(db, "Code Retrieval Buyer");
      const productId = await makeProduct(seller, "Code Retrieval Toy");
      const created = await createCashOrder(buyer, productId);
      await db.query("reset role");
      const stored = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [
        created.rows[0].order_id,
      ]);
      const r = await asUser(db, buyer, () =>
        db.query<{ get_my_collection_code: string }>(`select public.get_my_collection_code($1)`, [created.rows[0].order_id]),
      );
      expect(r.rows[0].get_my_collection_code).toBe(stored.rows[0].collection_code);
    });
  });

  describe("state machine invariants", () => {
    it("56. a completed order's status cannot be pushed back by decline_cash_order or accept_cash_order", async () => {
      const seller = await makeEligibleSeller("Invariant Seller");
      const buyer = await makeUser(db, "Invariant Buyer");
      const productId = await makeProduct(seller, "Invariant Toy");
      const created = await createCashOrder(buyer, productId);
      const orderId = created.rows[0].order_id;
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));

      await asUser(db, seller, async () => {
        await expect(db.query(`select public.accept_cash_order($1)`, [orderId])).rejects.toThrow(/not awaiting acceptance/i);
        await expect(db.query(`select public.decline_cash_order($1)`, [orderId])).rejects.toThrow(/cannot be declined/i);
      });

      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed");
    });
  });
});
