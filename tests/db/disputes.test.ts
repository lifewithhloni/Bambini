import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

// payments.provider_reference is unique — every simulated PayFast ITN
// needs its own distinct reference, never a shared literal, since every
// test in this file runs against one shared PGlite database (same
// pattern as every other tests/db/*.test.ts payout/order file).
let payfastRefCounter = 0;
function nextPayfastRef(): string {
  payfastRefCounter += 1;
  return `pf-dispute-test-ref-${payfastRefCounter}`;
}

let trackingRefCounter = 0;
function nextTrackingRef(): string {
  trackingRefCounter += 1;
  return `dispute-test-tracking-ref-${trackingRefCounter}`;
}

/**
 * Phase 9: disputes & transaction protection — exercised against the
 * real migration SQL and real Postgres. Covers open_dispute()/
 * respond_to_dispute()/resolve_dispute()/close_dispute(), the
 * orders.status = 'disputed' payout-protection mechanism (see this
 * phase's own migration comment for why NO payout-eligibility formula
 * needed to change), and every regression risk the migration calls out
 * (cash, delivery, existing payout claims). Items X-Z of this phase's
 * own test brief ("existing parent/business payout and transaction/
 * delivery/cash tests remain passing") are verified by the full
 * `npm run test:db` run rather than duplicated here.
 */
describe("disputes (Phase 9)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Dispute Admin");
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

  async function makeCompletedOnlineOrder(opts: { productId: string; seller: string; buyer?: string; priceCents: number }) {
    const buyer = opts.buyer ?? (await makeUser(db, `Dispute Buyer ${Math.random()}`));
    const created = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [opts.productId]),
    );
    const orderId = created.rows[0].order_id;
    await db.query("reset role");
    await db.query(`select public.process_payfast_itn($1, $2, 'paid', $3)`, [orderId, nextPayfastRef(), opts.priceCents]);
    const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
    await asUser(db, opts.seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
    await db.query("reset role");
    return { orderId, buyer };
  }

  async function makePendingPaymentOrder(opts: { productId: string; buyer?: string }) {
    const buyer = opts.buyer ?? (await makeUser(db, `Dispute Pending Buyer ${Math.random()}`));
    const created = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [opts.productId]),
    );
    return { orderId: created.rows[0].order_id, buyer };
  }

  async function openDisputeAs(user: string, orderId: string, reason = "item_not_as_described", description: string | null = "It arrived broken.") {
    const r = await asUser(db, user, () =>
      db.query<{ open_dispute: string }>(`select public.open_dispute($1, $2, $3)`, [orderId, reason, description]),
    );
    return r.rows[0].open_dispute;
  }

  describe("A-C. opening a dispute", () => {
    it("A. the buyer can open a dispute against an eligible (completed) order", async () => {
      const seller = await makeUser(db, "Open Dispute Seller");
      const productId = await makeParentProduct(seller, "Open Dispute Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });

      const disputeId = await openDisputeAs(buyer, orderId, "item_not_as_described", "Not as pictured.");

      await db.query("reset role");
      const dispute = await db.query<{ status: string; raised_by: string; reason: string; pre_dispute_order_status: string }>(
        `select status, raised_by, reason, pre_dispute_order_status from public.disputes where id = $1`,
        [disputeId],
      );
      expect(dispute.rows[0].status).toBe("open");
      expect(dispute.rows[0].raised_by).toBe(buyer);
      expect(dispute.rows[0].reason).toBe("item_not_as_described");
      expect(dispute.rows[0].pre_dispute_order_status).toBe("completed");

      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("disputed");
    });

    it("B. an unrelated user cannot open a dispute for someone else's order", async () => {
      const seller = await makeUser(db, "Unrelated Block Seller");
      const productId = await makeParentProduct(seller, "Unrelated Block Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const outsider = await makeUser(db, "Unrelated Block Outsider");

      await asUser(db, outsider, async () => {
        await expect(db.query(`select public.open_dispute($1, $2, $3)`, [orderId, "item_not_as_described", "not mine"])).rejects.toThrow(
          /only the buyer can open/i,
        );
      });
    });

    it("C. the seller cannot impersonate the buyer to open a dispute on their own sale", async () => {
      const seller = await makeUser(db, "Impersonate Buyer Seller");
      const productId = await makeParentProduct(seller, "Impersonate Buyer Toy", 50000);
      const { orderId } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });

      await asUser(db, seller, async () => {
        await expect(db.query(`select public.open_dispute($1, $2, $3)`, [orderId, "item_not_as_described", "I want to dispute my own sale"])).rejects.toThrow(
          /only the buyer can open/i,
        );
      });
    });
  });

  describe("D-F. seller response and business authorization", () => {
    it("D. the seller can respond to a dispute on their own transaction", async () => {
      const seller = await makeUser(db, "Respond Seller");
      const productId = await makeParentProduct(seller, "Respond Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, seller, () => db.query(`select public.respond_to_dispute($1, $2)`, [disputeId, "The item was accurately described."]));

      await db.query("reset role");
      const dispute = await db.query<{ seller_response: string; seller_responded_at: string | null; status: string }>(
        `select seller_response, seller_responded_at, status from public.disputes where id = $1`,
        [disputeId],
      );
      expect(dispute.rows[0].seller_response).toBe("The item was accurately described.");
      expect(dispute.rows[0].seller_responded_at).not.toBeNull();
      expect(dispute.rows[0].status).toBe("under_review"); // auto-advanced from 'open'
    });

    it("E. an unrelated seller cannot respond to a dispute that isn't theirs", async () => {
      const seller = await makeUser(db, "Response Isolation Seller");
      const otherSeller = await makeUser(db, "Response Isolation Other Seller");
      const productId = await makeParentProduct(seller, "Response Isolation Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, otherSeller, async () => {
        await expect(db.query(`select public.respond_to_dispute($1, $2)`, [disputeId, "not my sale"])).rejects.toThrow(/not authorized to respond/i);
      });
    });

    it("F. any business member (owner or staff) can respond to a dispute on a business order", async () => {
      const owner = await makeUser(db, "Business Response Owner");
      const staff = await makeUser(db, "Business Response Staff");
      const businessId = await makeVerifiedBusiness(owner, "Business Response Co", "business-response-co");
      await addStaffMember(businessId, staff);
      const productId = await makeBusinessProduct(businessId, "Business Response Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller: owner, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      // Staff can respond (operational action — any member, per this
      // function's own migration comment, unlike Phase 8C's owner-only
      // payout gate).
      await asUser(db, staff, () => db.query(`select public.respond_to_dispute($1, $2)`, [disputeId, "Staff responding on behalf of the business."]));

      await db.query("reset role");
      const dispute = await db.query<{ seller_response: string }>(`select seller_response from public.disputes where id = $1`, [disputeId]);
      expect(dispute.rows[0].seller_response).toBe("Staff responding on behalf of the business.");

      // An unrelated business owner still cannot.
      const otherOwner = await makeUser(db, "Business Response Other Owner");
      await asUser(db, otherOwner, async () => {
        await expect(db.query(`select public.respond_to_dispute($1, $2)`, [disputeId, "not my business"])).rejects.toThrow(/not authorized to respond/i);
      });
    });
  });

  describe("G-J. database integrity", () => {
    it("G. a duplicate active dispute for the same order is prevented", async () => {
      const seller = await makeUser(db, "Duplicate Dispute Seller");
      const productId = await makeParentProduct(seller, "Duplicate Dispute Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      await openDisputeAs(buyer, orderId);

      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.open_dispute($1, $2, $3)`, [orderId, "damaged_item", "second attempt"])).rejects.toThrow(
          /already has an active dispute/i,
        );
      });

      // The partial unique index is the irreducible backstop, independent of open_dispute()'s own pre-check.
      await db.query("reset role");
      const secondInsert = await db
        .query(`insert into public.disputes (order_id, raised_by, reason, status, pre_dispute_order_status) values ($1, $2, 'damaged_item', 'open', 'disputed')`, [orderId, buyer])
        .catch((e: Error) => e);
      expect(secondInsert).toBeInstanceOf(Error);
      expect((secondInsert as Error).message).toMatch(/disputes_order_id_active_unique/i);
    });

    it("H. an order still in pending_payment (never eligible) is rejected", async () => {
      const seller = await makeUser(db, "Pending Payment Dispute Seller");
      const productId = await makeParentProduct(seller, "Pending Payment Dispute Toy", 50000);
      const { orderId, buyer } = await makePendingPaymentOrder({ productId });

      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("pending_payment");

      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.open_dispute($1, $2, $3)`, [orderId, "item_not_received", null])).rejects.toThrow(
          /not eligible for a dispute/i,
        );
      });
    });

    it("H. a cancelled order is rejected", async () => {
      const seller = await makeUser(db, "Cancelled Dispute Seller");
      await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified', completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Cancelled Dispute Buyer");
      const productId = await makeParentProduct(seller, "Cancelled Dispute Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      // decline_cash_order() is the established path to a genuinely
      // 'cancelled' order from 'pending_payment' — reused here purely as
      // a fixture, not because this test is about cash decline itself.
      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1, 'out of stock')`, [orderId]));
      await db.query("reset role");
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("cancelled");

      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.open_dispute($1, $2, $3)`, [orderId, "item_not_received", null])).rejects.toThrow(
          /not eligible for a dispute/i,
        );
      });
    });

    it("I. an invalid dispute reason is rejected at the database level", async () => {
      const seller = await makeUser(db, "Invalid Reason Seller");
      const productId = await makeParentProduct(seller, "Invalid Reason Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });

      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.open_dispute($1, $2, $3)`, [orderId, "buyer_just_changed_their_mind", null])).rejects.toThrow();
      });
    });

    it("J. an invalid resolution outcome (e.g. 'open' or 'closed') is rejected", async () => {
      const seller = await makeUser(db, "Invalid Transition Seller");
      const productId = await makeParentProduct(seller, "Invalid Transition Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "closed", "trying to skip straight to closed"])).rejects.toThrow(
          /invalid resolution outcome/i,
        );
        await expect(db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "under_review", "trying to loop back"])).rejects.toThrow(
          /invalid resolution outcome/i,
        );
      });
    });

    it("J. resolving an already-resolved dispute a second time is rejected", async () => {
      const seller = await makeUser(db, "Double Resolve Seller");
      const productId = await makeParentProduct(seller, "Double Resolve Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);
      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", "Item matched description."]));

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_buyer", "trying again"])).rejects.toThrow(
          /only an open or under-review dispute can be resolved/i,
        );
      });
    });
  });

  describe("K-N. resolution authorization and correctness", () => {
    it("K. the buyer cannot resolve their own dispute", async () => {
      const seller = await makeUser(db, "Buyer Resolve Block Seller");
      const productId = await makeParentProduct(seller, "Buyer Resolve Block Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_buyer", "I win"])).rejects.toThrow(
          /admin authorization required/i,
        );
      });
    });

    it("L. the seller cannot resolve a dispute either", async () => {
      const seller = await makeUser(db, "Seller Resolve Block Seller");
      const productId = await makeParentProduct(seller, "Seller Resolve Block Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, seller, async () => {
        await expect(db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", "I win"])).rejects.toThrow(
          /admin authorization required/i,
        );
      });
    });

    it("M-N. an admin can resolve a dispute, and the resolution is recorded correctly", async () => {
      const seller = await makeUser(db, "Admin Resolve Seller");
      const productId = await makeParentProduct(seller, "Admin Resolve Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, admin, () =>
        db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", "Photos confirm the item matched the listing."]),
      );

      await db.query("reset role");
      const dispute = await db.query<{ status: string; resolution_notes: string; resolved_by: string; resolved_at: string | null }>(
        `select status, resolution_notes, resolved_by, resolved_at from public.disputes where id = $1`,
        [disputeId],
      );
      expect(dispute.rows[0].status).toBe("resolved_seller");
      expect(dispute.rows[0].resolution_notes).toBe("Photos confirm the item matched the listing.");
      expect(dispute.rows[0].resolved_by).toBe(admin);
      expect(dispute.rows[0].resolved_at).not.toBeNull();

      const action = await db.query<{ admin_id: string; action_type: string }>(
        `select admin_id, action_type from public.admin_actions where target_id = $1 and action_type = 'dispute.resolved'`,
        [disputeId],
      );
      expect(action.rows).toHaveLength(1);
      expect(action.rows[0].admin_id).toBe(admin);
    });

    it("resolve_dispute() requires non-empty resolution notes", async () => {
      const seller = await makeUser(db, "Empty Notes Seller");
      const productId = await makeParentProduct(seller, "Empty Notes Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, admin, async () => {
        await expect(db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", ""])).rejects.toThrow(
          /resolution notes are required/i,
        );
      });
    });

    it("close_dispute() is admin-only and only reachable from a resolved state", async () => {
      const seller = await makeUser(db, "Close Dispute Seller");
      const productId = await makeParentProduct(seller, "Close Dispute Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.close_dispute($1)`, [disputeId])).rejects.toThrow(/admin authorization required/i);
      });
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.close_dispute($1)`, [disputeId])).rejects.toThrow(/only a resolved dispute can be closed/i);
      });

      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", "Resolved."]));
      await asUser(db, admin, () => db.query(`select public.close_dispute($1)`, [disputeId]));

      await db.query("reset role");
      const dispute = await db.query<{ status: string }>(`select status from public.disputes where id = $1`, [disputeId]);
      expect(dispute.rows[0].status).toBe("closed");
    });
  });

  describe("O-S. payout interaction", () => {
    it("O-P. an active dispute blocks payout eligibility, and a seller-favouring resolution restores it", async () => {
      const seller = await makeUser(db, "Payout Block Seller");
      const productId = await makeParentProduct(seller, "Payout Block Toy", 100000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });

      // 1. eligible order contributes to available balance.
      const balanceBefore = await asUser(db, seller, () => db.query<{ get_seller_available_balance: string }>(`select public.get_seller_available_balance()`));
      expect(Number(balanceBefore.rows[0].get_seller_available_balance)).toBe(100000 - 12000);

      // 2-3. dispute opens, order stops contributing.
      const disputeId = await openDisputeAs(buyer, orderId);
      const balanceDuring = await asUser(db, seller, () => db.query<{ get_seller_available_balance: string }>(`select public.get_seller_available_balance()`));
      expect(Number(balanceDuring.rows[0].get_seller_available_balance)).toBe(0);

      await asUser(db, seller, async () => {
        await expect(db.query(`select public.request_seller_payout()`)).rejects.toThrow(/no eligible earnings/i);
      });

      // 4-5. dispute resolves seller/no-action, order becomes eligible again.
      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", "Item matched description."]));
      const balanceAfter = await asUser(db, seller, () => db.query<{ get_seller_available_balance: string }>(`select public.get_seller_available_balance()`));
      expect(Number(balanceAfter.rows[0].get_seller_available_balance)).toBe(100000 - 12000);

      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed"); // restored to its pre-dispute status
    });

    it("Q. a buyer-favouring resolution does not restore payout eligibility", async () => {
      const seller = await makeUser(db, "Buyer Wins Seller");
      const productId = await makeParentProduct(seller, "Buyer Wins Toy", 100000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });
      const disputeId = await openDisputeAs(buyer, orderId, "item_not_received");

      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_buyer", "Tracking shows it was never delivered."]));

      const balance = await asUser(db, seller, () => db.query<{ get_seller_available_balance: string }>(`select public.get_seller_available_balance()`));
      expect(Number(balance.rows[0].get_seller_available_balance)).toBe(0);
      await asUser(db, seller, async () => {
        await expect(db.query(`select public.request_seller_payout()`)).rejects.toThrow(/no eligible earnings/i);
      });

      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("disputed"); // deliberately never restored
    });

    it("R-S. a dispute opened after the seller was already paid out never touches the existing payout, paid or not", async () => {
      const seller = await makeUser(db, "Already Paid Dispute Seller");
      const productId = await makeParentProduct(seller, "Already Paid Dispute Toy", 100000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 100000 });

      const payoutId = await asUser(db, seller, () => db.query<{ request_seller_payout: string }>(`select public.request_seller_payout()`));
      await asUser(db, admin, () => db.query(`select public.mark_payout_paid($1, 'bank-ref-already-paid')`, [payoutId.rows[0].request_seller_payout]));

      const payoutBefore = await db.query<{ status: string; amount_cents: string }>(`select status, amount_cents from public.payouts where id = $1`, [
        payoutId.rows[0].request_seller_payout,
      ]);
      const itemBefore = await db.query<{ amount_cents: string; superseded_at: string | null }>(
        `select amount_cents, superseded_at from public.payout_items where payout_id = $1`,
        [payoutId.rows[0].request_seller_payout],
      );

      // A dispute can still be opened (the order stays 'completed' until
      // now — nothing about being paid out changes dispute eligibility).
      await openDisputeAs(buyer, orderId, "item_not_as_described");

      await db.query("reset role");
      const payoutAfter = await db.query<{ status: string; amount_cents: string }>(`select status, amount_cents from public.payouts where id = $1`, [
        payoutId.rows[0].request_seller_payout,
      ]);
      const itemAfter = await db.query<{ amount_cents: string; superseded_at: string | null }>(
        `select amount_cents, superseded_at from public.payout_items where payout_id = $1`,
        [payoutId.rows[0].request_seller_payout],
      );

      // Never silently reversed, never deleted, never re-flagged.
      expect(payoutAfter.rows[0].status).toBe(payoutBefore.rows[0].status);
      expect(payoutAfter.rows[0].status).toBe("paid");
      expect(payoutAfter.rows[0].amount_cents).toBe(payoutBefore.rows[0].amount_cents);
      expect(itemAfter.rows[0].amount_cents).toBe(itemBefore.rows[0].amount_cents);
      expect(itemAfter.rows[0].superseded_at).toBe(itemBefore.rows[0].superseded_at);
    });
  });

  describe("T. cash orders", () => {
    it("T. a dispute on a cash order never touches payments — no fake online refund is fabricated", async () => {
      const seller = await makeUser(db, "Cash Dispute Seller");
      await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified', completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Cash Dispute Buyer");
      const productId = await makeParentProduct(seller, "Cash Dispute Toy", 50000);
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      const orderId = created.rows[0].order_id;
      await asUser(db, seller, () => db.query(`select public.accept_cash_order($1)`, [orderId]));
      await db.query("reset role");

      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("confirmed"); // dispute eligibility doesn't require payments.status = 'paid' for cash

      const paymentBefore = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [orderId]);
      expect(paymentBefore.rows[0].status).toBe("pending"); // cash hasn't changed hands yet

      const disputeId = await openDisputeAs(buyer, orderId, "collection_problem", "Seller never showed up.");
      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_buyer", "Seller confirmed no-show."]));

      await db.query("reset role");
      const paymentAfter = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [orderId]);
      expect(paymentAfter.rows[0].status).toBe("pending"); // still untouched — never flipped to 'refunded'
    });
  });

  describe("U. delivery orders", () => {
    async function makeCompletedDeliveryOrder(seller: string, providerCostCents: number, markupPercentageBps: number, subtotalCents: number) {
      const buyer = await makeUser(db, `Dispute Delivery Buyer ${Math.random()}`);
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
         values ('parent', $1, $2, 'Dispute Delivery Toy', 'good', $3, 'published', true, true, $4)
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
      return { orderId, buyer };
    }

    it("U. a delivery-problem dispute never manipulates delivery_orders directly", async () => {
      const seller = await makeUser(db, "Dispute Delivery Seller");
      const { orderId, buyer } = await makeCompletedDeliveryOrder(seller, 5000, 2000, 100000);

      const deliveryBefore = await db.query<{ status: string }>(`select status from public.delivery_orders where order_id = $1`, [orderId]);
      expect(deliveryBefore.rows[0].status).toBe("delivered");

      const disputeId = await openDisputeAs(buyer, orderId, "item_not_received", "Tracking says delivered but I never got it.");
      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_buyer", "Confirmed misdelivery."]));

      await db.query("reset role");
      const deliveryAfter = await db.query<{ status: string }>(`select status from public.delivery_orders where order_id = $1`, [orderId]);
      expect(deliveryAfter.rows[0].status).toBe("delivered"); // untouched by the dispute lifecycle throughout
    });
  });

  describe("V. audit trail", () => {
    it("V. dispute.opened and dispute.seller_responded are recorded as transaction_events, never as admin_actions", async () => {
      const seller = await makeUser(db, "Audit Trail Seller");
      const productId = await makeParentProduct(seller, "Audit Trail Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);
      await asUser(db, seller, () => db.query(`select public.respond_to_dispute($1, $2)`, [disputeId, "We stand by the listing."]));

      await db.query("reset role");
      const openedEvent = await db.query<{ actor_type: string; actor_id: string; order_id: string }>(
        `select actor_type, actor_id, order_id from public.transaction_events where entity_type = 'dispute' and entity_id = $1 and event_type = 'dispute.opened'`,
        [disputeId],
      );
      expect(openedEvent.rows).toHaveLength(1);
      expect(openedEvent.rows[0].actor_type).toBe("buyer");
      expect(openedEvent.rows[0].actor_id).toBe(buyer);
      expect(openedEvent.rows[0].order_id).toBe(orderId);

      const respondedEvent = await db.query<{ actor_type: string; actor_id: string }>(
        `select actor_type, actor_id from public.transaction_events where entity_type = 'dispute' and entity_id = $1 and event_type = 'dispute.seller_responded'`,
        [disputeId],
      );
      expect(respondedEvent.rows).toHaveLength(1);
      expect(respondedEvent.rows[0].actor_type).toBe("seller");
      expect(respondedEvent.rows[0].actor_id).toBe(seller);
    });

    it("V. dispute.resolved and dispute.closed are recorded as admin_actions, never as transaction_events", async () => {
      const seller = await makeUser(db, "Admin Audit Seller");
      const productId = await makeParentProduct(seller, "Admin Audit Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);
      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, $2, $3)`, [disputeId, "resolved_seller", "No issue found."]));
      await asUser(db, admin, () => db.query(`select public.close_dispute($1)`, [disputeId]));

      await db.query("reset role");
      const resolvedAction = await db.query(`select id from public.admin_actions where target_id = $1 and action_type = 'dispute.resolved'`, [disputeId]);
      const closedAction = await db.query(`select id from public.admin_actions where target_id = $1 and action_type = 'dispute.closed'`, [disputeId]);
      expect(resolvedAction.rows).toHaveLength(1);
      expect(closedAction.rows).toHaveLength(1);

      const stray = await db.query(`select id from public.transaction_events where entity_type = 'dispute' and entity_id = $1 and event_type in ('dispute.resolved', 'dispute.closed')`, [disputeId]);
      expect(stray.rows).toHaveLength(0);
    });
  });

  describe("W. RLS prevents cross-user access", () => {
    it("an anonymous user cannot read any dispute", async () => {
      const seller = await makeUser(db, "Anon Block Seller");
      const productId = await makeParentProduct(seller, "Anon Block Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      const anonSees = await asAnon(db, () => db.query(`select id from public.disputes where id = $1`, [disputeId]));
      expect(anonSees.rows).toHaveLength(0);
    });

    it("an unrelated user cannot read a dispute they have nothing to do with", async () => {
      const seller = await makeUser(db, "RLS Block Seller");
      const productId = await makeParentProduct(seller, "RLS Block Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);
      const outsider = await makeUser(db, "RLS Block Outsider");

      const outsiderSees = await asUser(db, outsider, () => db.query(`select id from public.disputes where id = $1`, [disputeId]));
      expect(outsiderSees.rows).toHaveLength(0);
    });

    it("the buyer, the seller, and the admin can all read the dispute", async () => {
      const seller = await makeUser(db, "RLS Allow Seller");
      const productId = await makeParentProduct(seller, "RLS Allow Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });
      const disputeId = await openDisputeAs(buyer, orderId);

      const buyerSees = await asUser(db, buyer, () => db.query(`select id from public.disputes where id = $1`, [disputeId]));
      const sellerSees = await asUser(db, seller, () => db.query(`select id from public.disputes where id = $1`, [disputeId]));
      const adminSees = await asUser(db, admin, () => db.query(`select id from public.disputes where id = $1`, [disputeId]));
      expect(buyerSees.rows).toHaveLength(1);
      expect(sellerSees.rows).toHaveLength(1);
      expect(adminSees.rows).toHaveLength(1);
    });

    it("no client role can directly insert or update a dispute row — every write goes through a function", async () => {
      const seller = await makeUser(db, "Direct Write Block Seller");
      const productId = await makeParentProduct(seller, "Direct Write Block Toy", 50000);
      const { orderId, buyer } = await makeCompletedOnlineOrder({ productId, seller, priceCents: 50000 });

      await asUser(db, buyer, async () => {
        await expect(
          db.query(`insert into public.disputes (order_id, raised_by, reason, status, pre_dispute_order_status) values ($1, $2, 'other', 'open', 'completed')`, [orderId, buyer]),
        ).rejects.toThrow();
      });

      const disputeId = await openDisputeAs(buyer, orderId);
      const updated = await asUser(db, admin, () => db.query(`update public.disputes set status = 'resolved_buyer', resolution_notes = 'forged' where id = $1`, [disputeId]));
      expect(updated.affectedRows).toBe(0); // even an admin's own ordinary session cannot bypass resolve_dispute()
    });
  });
});
