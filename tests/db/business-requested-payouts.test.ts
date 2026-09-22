import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

// payments.provider_reference is unique — every simulated PayFast ITN
// needs its own distinct reference, never a shared literal, since every
// test in this file runs against one shared PGlite database (same
// pattern as every other tests/db/*.test.ts payout file).
let payfastRefCounter = 0;
function nextPayfastRef(): string {
  payfastRefCounter += 1;
  return `pf-biz-request-test-ref-${payfastRefCounter}`;
}

let trackingRefCounter = 0;
function nextTrackingRef(): string {
  trackingRefCounter += 1;
  return `biz-payout-request-tracking-ref-${trackingRefCounter}`;
}

/**
 * Phase 8C: business seller self-service payout requests —
 * get_business_available_balance() and request_business_payout(),
 * exercised against the real migration SQL and real Postgres. Per this
 * phase's own authorization model (see
 * 20261007090000_business_requested_payouts.sql), only the business
 * OWNER (businesses.owner_profile_id) may request a payout; any
 * business member (owner or staff, via is_business_member()) may read
 * the balance/history. Items T-V of this phase's own test brief
 * ("existing parent/admin/RLS tests remain passing") are verified by
 * the full `npm run test:db` run rather than duplicated here — every
 * pre-existing *.test.ts file is unchanged and runs unmodified in the
 * same suite.
 */
describe("business-requested payouts (Phase 8C)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Business Payout Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.query("reset role");
  });

  async function makeVerifiedBusiness(ownerId: string, businessName: string, slug: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, $2, $3, 'verified') returning id`,
      [ownerId, businessName, slug],
    );
    return r.rows[0].id;
  }

  async function addStaffMember(businessId: string, profileId: string): Promise<void> {
    await db.query(`insert into public.business_members (business_id, profile_id, role) values ($1, $2, 'staff')`, [businessId, profileId]);
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

  /** confirm_collection() accepts the owner OR any business_members row (is_business_member()) — confirmingUser lets a test exercise either. */
  async function makeCompletedBusinessOrder(opts: { productId: string; owner: string; confirmingUser?: string; buyer?: string; priceCents: number }) {
    const buyer = opts.buyer ?? (await makeUser(db, `Biz Payout Buyer ${Math.random()}`));
    const created = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [opts.productId]),
    );
    const orderId = created.rows[0].order_id;
    await db.query("reset role");
    await db.query(`select public.process_payfast_itn($1, $2, 'paid', $3)`, [orderId, nextPayfastRef(), opts.priceCents]);
    const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
    await asUser(db, opts.confirmingUser ?? opts.owner, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
    await db.query("reset role");
    const order = await db.query<{ subtotal_cents: string; commission_amount_cents: string }>(
      `select subtotal_cents, commission_amount_cents from public.orders where id = $1`,
      [orderId],
    );
    return { orderId, buyer, subtotalCents: Number(order.rows[0].subtotal_cents), commissionAmountCents: Number(order.rows[0].commission_amount_cents) };
  }

  async function balanceOf(user: string, businessId: string): Promise<number> {
    const r = await asUser(db, user, () => db.query<{ get_business_available_balance: string }>(`select public.get_business_available_balance($1)`, [businessId]));
    return Number(r.rows[0].get_business_available_balance);
  }

  async function requestPayoutAs(user: string, businessId: string): Promise<string> {
    const r = await asUser(db, user, () => db.query<{ request_business_payout: string }>(`select public.request_business_payout($1)`, [businessId]));
    return r.rows[0].request_business_payout;
  }

  describe("A-B. available balance and 15% commission (A, B)", () => {
    it("A-B. the business's available balance equals the sum of net earnings at the 15% business commission rate", async () => {
      const owner = await makeUser(db, "Balance Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Balance Co", "balance-co");
      const productId = await makeBusinessProduct(businessId, "Balance Biz Toy", 100000);
      const { orderId } = await makeCompletedBusinessOrder({ productId, owner, priceCents: 100000 });

      const commission = await db.query<{ rate_bps: number; commission_amount_cents: string }>(`select rate_bps, commission_amount_cents from public.commissions where order_id = $1`, [orderId]);
      expect(commission.rows[0].rate_bps).toBe(1500); // 15% business rate, unchanged from Phase 8A

      const balance = await balanceOf(owner, businessId);
      expect(balance).toBe(100000 - 15000);
    });
  });

  describe("C-D. delivery fee and margin excluded (C, D)", () => {
    async function makeCompletedBusinessDeliveryOrder(businessId: string, owner: string, providerCostCents: number, markupPercentageBps: number, subtotalCents: number) {
      const buyer = await makeUser(db, `Biz Delivery Buyer ${Math.random()}`);
      const businessLocationId = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude) values ($1, -33.95, 18.45) returning id`,
        [owner],
      );
      const buyerLocationId = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude) values ($1, -33.9, 18.4) returning id`,
        [buyer],
      );
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId.rows[0].id, buyer]);
      const productId = await db.query<{ id: string }>(
        `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available, pickup_location_id)
         values ('business', $1, $2, 'Biz Delivery Toy', 'good', $3, 'published', true, true, $4)
         returning id`,
        [businessId, categoryId, subtotalCents, businessLocationId.rows[0].id],
      );
      const quoteId = await makeDeliveryQuote(db, {
        buyerId: buyer,
        productId: productId.rows[0].id,
        pickupLocationId: businessLocationId.rows[0].id,
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
      return { orderId };
    }

    it("C-D. the buyer's delivery fee never increases business earnings, and Bambini's delivery margin stays entirely separate", async () => {
      const owner = await makeUser(db, "Delivery Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Delivery Co", "delivery-co");
      const { orderId } = await makeCompletedBusinessDeliveryOrder(businessId, owner, 5000, 2000, 100000); // R50 cost, 20% markup -> R60 fee, R1000 subtotal

      await db.query("reset role");
      const order = await db.query<{ total_cents: string }>(`select total_cents from public.orders where id = $1`, [orderId]);
      expect(Number(order.rows[0].total_cents)).toBe(100000 + 6000);

      const balance = await balanceOf(owner, businessId);
      expect(balance).toBe(100000 - 15000); // never subtotal + delivery fee - commission

      const payoutId = await requestPayoutAs(owner, businessId);
      await db.query("reset role");
      const payout = await db.query<{ amount_cents: string }>(`select amount_cents from public.payouts where id = $1`, [payoutId]);
      expect(Number(payout.rows[0].amount_cents)).toBe(100000 - 15000);
    });
  });

  describe("E-G. exclusions (E, F, G)", () => {
    it("E. a completed cash order contributes nothing to the business's available balance", async () => {
      const owner = await makeUser(db, "Cash Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Cash Co", "cash-co");
      await db.query(`update public.businesses set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [businessId]);
      const buyer = await makeUser(db, "Cash Business Buyer");
      const productId = await makeBusinessProduct(businessId, "Cash Biz Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      await asUser(db, owner, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      await asUser(db, owner, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));

      expect(await balanceOf(owner, businessId)).toBe(0);
      await asUser(db, owner, async () => {
        await expect(db.query(`select public.request_business_payout($1)`, [businessId])).rejects.toThrow(/no eligible earnings/i);
      });
    });

    it("F. an order that is paid but not yet completed is excluded from the balance", async () => {
      const owner = await makeUser(db, "Incomplete Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Incomplete Co", "incomplete-co");
      const buyer = await makeUser(db, "Incomplete Business Buyer");
      const productId = await makeBusinessProduct(businessId, "Incomplete Biz Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
      const orderId = created.rows[0].order_id;
      await db.query("reset role");
      await db.query(`select public.process_payfast_itn($1, $2, 'paid', 50000)`, [orderId, nextPayfastRef()]);
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("confirmed"); // not completed yet

      expect(await balanceOf(owner, businessId)).toBe(0);
    });

    it("G. an order already claimed by an active payout is not counted again", async () => {
      const owner = await makeUser(db, "Already Claimed Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Already Claimed Co", "already-claimed-co");
      const productId = await makeBusinessProduct(businessId, "Already Claimed Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });
      await requestPayoutAs(owner, businessId);

      expect(await balanceOf(owner, businessId)).toBe(0);
    });
  });

  describe("H. recovered orders become available again", () => {
    it("H. after admin recovery, a failed business payout's earnings become available again", async () => {
      const owner = await makeUser(db, "Recovery Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Recovery Co", "recovery-co");
      const productId = await makeBusinessProduct(businessId, "Recovery Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });
      const payoutId = await requestPayoutAs(owner, businessId);
      await asUser(db, admin, () => db.query(`select public.mark_payout_failed($1, 'bank rejected transfer')`, [payoutId]));

      expect(await balanceOf(owner, businessId)).toBe(0); // Q. failed payout remains claimed

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      expect(await balanceOf(owner, businessId)).toBe(50000 - 7500); // R. recovery releases the earnings
    });
  });

  describe("I-J. authorization (I, J)", () => {
    it("I. the authorized business owner can request the business's balance", async () => {
      const owner = await makeUser(db, "Authorized Owner Requests");
      const businessId = await makeVerifiedBusiness(owner, "Authorized Co", "authorized-co");
      const productId = await makeBusinessProduct(businessId, "Authorized Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });

      const payoutId = await requestPayoutAs(owner, businessId);
      await db.query("reset role");
      const payout = await db.query<{ status: string; recipient_type: string; recipient_business_id: string }>(
        `select status, recipient_type, recipient_business_id from public.payouts where id = $1`,
        [payoutId],
      );
      expect(payout.rows[0].status).toBe("pending");
      expect(payout.rows[0].recipient_type).toBe("business");
      expect(payout.rows[0].recipient_business_id).toBe(businessId); // 5. financial ownership belongs to the business, not the member
    });

    it("J. a staff member (not the owner) cannot request a payout, even though they can confirm orders and read the balance", async () => {
      const owner = await makeUser(db, "Staff Block Owner");
      const staff = await makeUser(db, "Staff Block Staff");
      const businessId = await makeVerifiedBusiness(owner, "Staff Block Co", "staff-block-co");
      await addStaffMember(businessId, staff);
      const productId = await makeBusinessProduct(businessId, "Staff Block Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, confirmingUser: staff, priceCents: 50000 });

      // Staff CAN read the balance (any member) ...
      expect(await balanceOf(staff, businessId)).toBe(50000 - 7500);
      // ... but cannot request a payout.
      await asUser(db, staff, async () => {
        await expect(db.query(`select public.request_business_payout($1)`, [businessId])).rejects.toThrow(/only the business owner can request/i);
      });

      // The owner still can.
      const payoutId = await requestPayoutAs(owner, businessId);
      expect(payoutId).toBeTruthy();
    });
  });

  describe("K, N. cross-business isolation and impersonation (K, N)", () => {
    it("K. an unrelated user (not a member of the business at all) cannot read its balance or request a payout", async () => {
      const owner = await makeUser(db, "Isolated Business Owner");
      const outsider = await makeUser(db, "Isolated Business Outsider");
      const businessId = await makeVerifiedBusiness(owner, "Isolated Co", "isolated-co");
      const productId = await makeBusinessProduct(businessId, "Isolated Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });

      await asUser(db, outsider, async () => {
        await expect(db.query(`select public.get_business_available_balance($1)`, [businessId])).rejects.toThrow(/not authorized/i);
        await expect(db.query(`select public.request_business_payout($1)`, [businessId])).rejects.toThrow(/only the business owner can request/i);
      });
    });

    it("N. a member of business A cannot impersonate business B by passing its id — every business's balance stays isolated", async () => {
      const ownerA = await makeUser(db, "Impersonation Owner A");
      const ownerB = await makeUser(db, "Impersonation Owner B");
      const businessA = await makeVerifiedBusiness(ownerA, "Impersonation Co A", "impersonation-co-a");
      const businessB = await makeVerifiedBusiness(ownerB, "Impersonation Co B", "impersonation-co-b");
      const productB = await makeBusinessProduct(businessB, "Impersonation Biz Toy B", 100000);
      await makeCompletedBusinessOrder({ productId: productB, owner: ownerB, priceCents: 100000 });

      // Owner A tries to read/claim business B's earnings using B's id.
      await asUser(db, ownerA, async () => {
        await expect(db.query(`select public.get_business_available_balance($1)`, [businessB])).rejects.toThrow(/not authorized/i);
        await expect(db.query(`select public.request_business_payout($1)`, [businessB])).rejects.toThrow(/only the business owner can request/i);
      });

      await db.query("reset role");
      expect(await balanceOf(ownerB, businessB)).toBe(100000 - 15000); // untouched by owner A's attempt
      void businessA;
    });
  });

  describe("L-M. client cannot control amount or orders (L, M)", () => {
    it("L-M. request_business_payout() takes only a business id — no amount, no order ids, nothing else for the client to supply", async () => {
      const r = await db.query<{ proargnames: string[] | null }>(`select proargnames from pg_proc where proname = 'request_business_payout'`);
      expect(r.rows[0].proargnames ?? []).toEqual(["p_business_id"]);
    });
  });

  describe("O. concurrency", () => {
    it("O. two concurrent request_business_payout() calls for the same business never both succeed or double-claim", async () => {
      const owner = await makeUser(db, "Concurrent Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Concurrent Co", "concurrent-co");
      const productA = await makeBusinessProduct(businessId, "Concurrent Biz Toy A", 88000);
      const productB = await makeBusinessProduct(businessId, "Concurrent Biz Toy B", 45000);
      const orderA = await makeCompletedBusinessOrder({ productId: productA, owner, priceCents: 88000 });
      const orderB = await makeCompletedBusinessOrder({ productId: productB, owner, priceCents: 45000 });

      const results = await Promise.allSettled([
        asUser(db, owner, () => db.query<{ request_business_payout: string }>(`select public.request_business_payout($1)`, [businessId])),
        asUser(db, owner, () => db.query<{ request_business_payout: string }>(`select public.request_business_payout($1)`, [businessId])),
      ]);
      const succeeded = results.filter((r) => r.status === "fulfilled");
      expect(succeeded.length).toBeLessThanOrEqual(1);

      await db.query("reset role");
      const activeA = await db.query<{ payout_id: string }>(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderA.orderId]);
      const activeB = await db.query<{ payout_id: string }>(`select payout_id from public.payout_items where order_id = $1 and superseded_at is null`, [orderB.orderId]);
      expect(activeA.rows).toHaveLength(1);
      expect(activeB.rows).toHaveLength(1);
      expect(activeA.rows[0].payout_id).toBe(activeB.rows[0].payout_id); // both landed in the SAME single payout
    });
  });

  describe("P. multiple payouts over time", () => {
    it("P. after a payout is paid, newly completed orders form a separate, later payout", async () => {
      const owner = await makeUser(db, "Multiple Business Payouts Owner");
      const businessId = await makeVerifiedBusiness(owner, "Multiple Payouts Co", "multiple-payouts-co");
      const productA = await makeBusinessProduct(businessId, "First Biz Payout Toy", 100000);
      await makeCompletedBusinessOrder({ productId: productA, owner, priceCents: 100000 });
      const firstPayoutId = await requestPayoutAs(owner, businessId);
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, 'bank-ref-biz-1')`, [firstPayoutId]));

      expect(await balanceOf(owner, businessId)).toBe(0);

      const productB = await makeBusinessProduct(businessId, "Second Biz Payout Toy", 50000);
      await makeCompletedBusinessOrder({ productId: productB, owner, priceCents: 50000 });
      expect(await balanceOf(owner, businessId)).toBe(50000 - 7500);

      const secondPayoutId = await requestPayoutAs(owner, businessId);
      expect(secondPayoutId).not.toBe(firstPayoutId);

      await db.query("reset role");
      const first = await db.query<{ status: string; amount_cents: string }>(`select status, amount_cents from public.payouts where id = $1`, [firstPayoutId]);
      expect(first.rows[0].status).toBe("paid");
      expect(Number(first.rows[0].amount_cents)).toBe(100000 - 15000); // untouched by the second payout
    });
  });

  describe("Q-S. recovery lifecycle (Q, R, S)", () => {
    it("Q-S. a failed payout stays claimed until recovered, and a new payout requires an explicit re-request", async () => {
      const owner = await makeUser(db, "Recovery Lifecycle Owner");
      const businessId = await makeVerifiedBusiness(owner, "Recovery Lifecycle Co", "recovery-lifecycle-co");
      const productId = await makeBusinessProduct(businessId, "Recovery Lifecycle Biz Toy", 100000);
      const { orderId } = await makeCompletedBusinessOrder({ productId, owner, priceCents: 100000 });
      const payoutId = await requestPayoutAs(owner, businessId);
      await asUser(db, admin, () => db.query(`select public.mark_payout_failed($1, 'bank rejected transfer')`, [payoutId]));

      // Q. remains claimed until recovered.
      expect(await balanceOf(owner, businessId)).toBe(0);
      await asUser(db, owner, async () => {
        await expect(db.query(`select public.request_business_payout($1)`, [businessId])).rejects.toThrow(/no eligible earnings/i);
      });

      await asUser(db, admin, () => db.query(`select public.recover_failed_payout($1, $2)`, [payoutId, "Confirmed funds never left Bambini's account."]));

      // R. recovery releases the earnings.
      expect(await balanceOf(owner, businessId)).toBe(100000 - 15000);

      // No automatic replacement payout was created.
      await db.query("reset role");
      const payoutsForBusiness = await db.query(`select id from public.payouts where recipient_business_id = $1`, [businessId]);
      expect(payoutsForBusiness.rows).toHaveLength(1);

      // S. the owner must explicitly request the new payout.
      const newPayoutId = await requestPayoutAs(owner, businessId);
      expect(newPayoutId).not.toBe(payoutId);
      await db.query("reset role");
      const newItem = await db.query<{ amount_cents: string }>(`select amount_cents from public.payout_items where payout_id = $1 and order_id = $2`, [newPayoutId, orderId]);
      expect(newItem.rows).toHaveLength(1);

      const original = await db.query<{ status: string }>(`select status from public.payouts where id = $1`, [payoutId]);
      expect(original.rows[0].status).toBe("recovered"); // historical, untouched
    });
  });

  describe("RLS: business payout visibility", () => {
    it("an anonymous caller and an unrelated parent seller cannot read a business's payout information", async () => {
      const owner = await makeUser(db, "RLS Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "RLS Co", "rls-co");
      const productId = await makeBusinessProduct(businessId, "RLS Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });
      const payoutId = await requestPayoutAs(owner, businessId);

      const anonSees = await asAnon(db, () => db.query(`select id from public.payouts where id = $1`, [payoutId]));
      expect(anonSees.rows).toHaveLength(0);

      const unrelatedParent = await makeUser(db, "RLS Unrelated Parent Seller");
      const unrelatedSees = await asUser(db, unrelatedParent, () => db.query(`select id from public.payouts where id = $1`, [payoutId]));
      expect(unrelatedSees.rows).toHaveLength(0);
    });

    it("admin can read a business payout, including its order lines", async () => {
      const owner = await makeUser(db, "Admin Sees Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Admin Sees Co", "admin-sees-co");
      const productId = await makeBusinessProduct(businessId, "Admin Sees Biz Toy", 50000);
      const { orderId } = await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });
      const payoutId = await requestPayoutAs(owner, businessId);

      const adminSees = await asUser(db, admin, () => db.query<{ id: string }>(`select id from public.payouts where id = $1`, [payoutId]));
      expect(adminSees.rows).toHaveLength(1);
      const adminSeesItems = await asUser(db, admin, () => db.query<{ order_id: string }>(`select order_id from public.payout_items where payout_id = $1`, [payoutId]));
      expect(adminSeesItems.rows.map((r) => r.order_id)).toEqual([orderId]);
    });

    it("no client role can directly manipulate a business payout's amount", async () => {
      const owner = await makeUser(db, "Immutable Business Owner");
      const businessId = await makeVerifiedBusiness(owner, "Immutable Co", "immutable-co");
      const productId = await makeBusinessProduct(businessId, "Immutable Biz Toy", 50000);
      await makeCompletedBusinessOrder({ productId, owner, priceCents: 50000 });
      const payoutId = await requestPayoutAs(owner, businessId);

      const updated = await asUser(db, owner, () => db.query(`update public.payouts set amount_cents = 1 where id = $1`, [payoutId]));
      expect(updated.affectedRows).toBe(0);
    });
  });

  describe("authorization boundary", () => {
    it("an anonymous caller cannot call request_business_payout() or get_business_available_balance()", async () => {
      const owner = await makeUser(db, "Anon Boundary Owner");
      const businessId = await makeVerifiedBusiness(owner, "Anon Boundary Co", "anon-boundary-co");

      await asAnon(db, async () => {
        await expect(db.query(`select public.request_business_payout($1)`, [businessId])).rejects.toThrow();
        await expect(db.query(`select public.get_business_available_balance($1)`, [businessId])).rejects.toThrow();
      });
    });
  });
});
