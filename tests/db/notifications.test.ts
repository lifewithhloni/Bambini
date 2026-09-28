import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

let refCounter = 0;
const nextRef = () => `pf-notif-test-ref-${(refCounter += 1)}`;
let idCounter = 0;
const nextIdNumber = () => `7001015${String((idCounter += 1)).padStart(6, "0")}`;

type Note = { profile_id: string; type: string; title: string; body: string | null; data: Record<string, unknown>; read_at: string | null; event_key: string };

const ALLOWED_DATA_KEYS = new Set(["order_id", "audience", "business_id", "thread_id", "kind", "status"]);

/**
 * Phase 14C: in-app notifications exercised against the real migration SQL.
 * public.notifications existed since the foundation schema but nothing wrote
 * to it and any recipient could rewrite every column of their own rows;
 * 20261013090000_in_app_notifications.sql adds the idempotency key, the
 * controlled types, read_at-only writes and the server-side producers proven
 * here. Items S/T/U of the brief ("existing messaging / favourites / order /
 * payment / payout / dispute / verification suites still pass") are verified
 * by the full `npm run test:db` run rather than duplicated here.
 */
describe("in-app notifications (Phase 14C)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Notif Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.query("reset role");
  });

  async function notesFor(profileId: string): Promise<Note[]> {
    await db.query("reset role");
    const r = await db.query<Note>(`select profile_id, type, title, body, data, read_at, event_key from public.notifications where profile_id = $1 order by created_at, event_key`, [profileId]);
    return r.rows;
  }

  async function parentProduct(seller: string, title = "Notif Toy", priceCents = 40000) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, $3, 'good', $4, 'published', true, true) returning id`,
      [seller, categoryId, title, priceCents],
    );
    return r.rows[0].id;
  }

  async function businessWithStaff(name: string) {
    const owner = await makeUser(db, `${name} Owner`);
    const staff = await makeUser(db, `${name} Staff`);
    const b = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, $2, $3, 'verified') returning id`,
      [owner, name, `${name.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`],
    );
    await db.query(`insert into public.business_members (business_id, profile_id, role) values ($1, $2, 'staff')`, [b.rows[0].id, staff]);
    return { owner, staff, businessId: b.rows[0].id };
  }

  async function businessProduct(businessId: string, title = "Notif Biz Item", priceCents = 60000) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('business', $1, $2, $3, 'good', $4, 'published', true, true) returning id`,
      [businessId, categoryId, title, priceCents],
    );
    return r.rows[0].id;
  }

  async function placeOnlineOrder(productId: string, buyer: string): Promise<string> {
    const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
    await db.query("reset role");
    return created.rows[0].order_id;
  }

  async function payOrder(orderId: string, cents: number, ref = nextRef()) {
    await db.query("reset role");
    await db.query(`select public.process_payfast_itn($1, $2, 'paid', $3)`, [orderId, ref, cents]);
    return ref;
  }

  async function paidOrder(productId: string, buyer: string, cents: number) {
    const orderId = await placeOnlineOrder(productId, buyer);
    await payOrder(orderId, cents);
    return orderId;
  }

  async function emit(orderId: string, eventType: string, entityType = "order") {
    await db.query("reset role");
    await db.query(
      `insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type) values ($1, $2, $3, $4, 'system')`,
      [orderId, entityType, orderId, eventType],
    );
  }

  const titles = (notes: Note[]) => notes.map((n) => n.title);

  describe("A-E, H, R. privacy and write authority", () => {
    it("A. a recipient reads their own notifications, B. and never another user's", async () => {
      const seller = await makeUser(db, "Read Seller");
      const buyer = await makeUser(db, "Read Buyer");
      const stranger = await makeUser(db, "Read Stranger");
      await paidOrder(await parentProduct(seller), buyer, 40000);

      const mine = await asUser(db, buyer, () => db.query<{ title: string }>(`select title from public.notifications`));
      expect(mine.rows.map((r) => r.title)).toEqual(["Payment received"]);

      const theirs = await asUser(db, stranger, () => db.query(`select id from public.notifications`));
      expect(theirs.rows).toHaveLength(0);
      const filtered = await asUser(db, stranger, () => db.query(`select id from public.notifications where profile_id = $1`, [buyer]));
      expect(filtered.rows).toHaveLength(0);
    });

    it("R. anonymous visitors cannot read notifications at all", async () => {
      await expect(asAnon(db, () => db.query(`select id from public.notifications`))).rejects.toThrow(/permission denied/i);
    });

    it("C. a recipient can mark their own notification read; D. nobody else can", async () => {
      const seller = await makeUser(db, "Mark Seller");
      const buyer = await makeUser(db, "Mark Buyer");
      const stranger = await makeUser(db, "Mark Stranger");
      await paidOrder(await parentProduct(seller), buyer, 40000);
      const [note] = await notesFor(buyer);
      expect(note.read_at).toBeNull();

      const byStranger = await asUser(db, stranger, () => db.query(`update public.notifications set read_at = now() where id = (select id from public.notifications where profile_id = $1)`, [buyer]));
      expect(byStranger.affectedRows).toBe(0);
      const byStrangerDirect = await asUser(db, stranger, () => db.query(`update public.notifications set read_at = now() where profile_id = $1`, [buyer]));
      expect(byStrangerDirect.affectedRows).toBe(0);
      expect((await notesFor(buyer))[0].read_at).toBeNull();

      const byOwner = await asUser(db, buyer, () => db.query(`update public.notifications set read_at = now() where profile_id = $1`, [buyer]));
      expect(byOwner.affectedRows).toBe(1);
      expect((await notesFor(buyer))[0].read_at).not.toBeNull();
    });

    it("E. a client cannot create, reassign, edit or delete notifications, nor call a producer", async () => {
      const seller = await makeUser(db, "Forge Seller");
      const buyer = await makeUser(db, "Forge Buyer");
      const victim = await makeUser(db, "Forge Victim");
      await paidOrder(await parentProduct(seller), buyer, 40000);

      await expect(
        asUser(db, buyer, () => db.query(`insert into public.notifications (profile_id, type, title, event_key) values ($1, 'order_updated', 'Forged', 'forged-1')`, [buyer])),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asUser(db, buyer, () => db.query(`insert into public.notifications (profile_id, type, title, event_key) values ($1, 'order_updated', 'Forged', 'forged-2')`, [victim])),
      ).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, buyer, () => db.query(`update public.notifications set title = 'Edited' where profile_id = $1`, [buyer]))).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, buyer, () => db.query(`update public.notifications set profile_id = $1 where profile_id = $2`, [victim, buyer]))).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, buyer, () => db.query(`update public.notifications set data = '{}'::jsonb where profile_id = $1`, [buyer]))).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, buyer, () => db.query(`delete from public.notifications where profile_id = $1`, [buyer]))).rejects.toThrow(/permission denied/i);
      await expect(
        asUser(db, buyer, () => db.query(`select public.push_notification($1, 'order_updated', 'x', 'y', '{}'::jsonb, 'k')`, [victim])),
      ).rejects.toThrow(/permission denied/i);
      expect(titles(await notesFor(victim))).toEqual([]);
    });

    it("E. no producer or trigger function is executable by any client role", async () => {
      const fns = [
        "push_notification(uuid,text,text,text,jsonb,text)",
        "notification_business_recipients(uuid)",
        "notify_order_audience(uuid,text,text,text,text,text)",
        "push_message_notification(uuid,uuid,uuid,uuid)",
        "notify_on_transaction_event()",
        "notify_on_dispute_resolved()",
        "notify_on_message()",
        "notify_on_identity_verification_decision()",
        "notify_on_business_verification_decision()",
        "notify_on_payout_outcome()",
      ];
      for (const fn of fns) {
        for (const role of ["anon", "authenticated"]) {
          const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.${fn}', 'execute') as ok`, [role]);
          expect(r.rows[0].ok, `${role} must not execute ${fn}`).toBe(false);
        }
      }
    });

    it("H. read state is server-authoritative: the timestamp is server-set and a read notification can never be marked unread", async () => {
      const seller = await makeUser(db, "Auth Seller");
      const buyer = await makeUser(db, "Auth Buyer");
      await paidOrder(await parentProduct(seller), buyer, 40000);

      await asUser(db, buyer, () => db.query(`update public.notifications set read_at = '2000-01-01T00:00:00Z' where profile_id = $1`, [buyer]));
      const [afterRead] = await notesFor(buyer);
      expect(new Date(afterRead.read_at as string).getFullYear()).toBeGreaterThan(2020);

      await asUser(db, buyer, () => db.query(`update public.notifications set read_at = null where profile_id = $1`, [buyer]));
      expect((await notesFor(buyer))[0].read_at).toEqual(afterRead.read_at);
    });

    it("the notification type is a controlled list, not free-form text", async () => {
      const u = await makeUser(db, "Type User");
      await expect(db.query(`insert into public.notifications (profile_id, type, title, event_key) values ($1, 'whatever', 'x', 'k1')`, [u])).rejects.toThrow(/notifications_type_known/i);
    });
  });

  describe("F. idempotency", () => {
    it("a replayed payment webhook does not create duplicate notifications", async () => {
      const seller = await makeUser(db, "Replay Seller");
      const buyer = await makeUser(db, "Replay Buyer");
      const orderId = await placeOnlineOrder(await parentProduct(seller), buyer);
      const ref = await payOrder(orderId, 40000);
      await payOrder(orderId, 40000, ref);
      await payOrder(orderId, 40000, ref);

      expect(titles(await notesFor(buyer))).toEqual(["Payment received"]);
      expect(titles(await notesFor(seller))).toEqual(["Payment received"]);
    });

    it("the same event key for the same recipient is stored once, however many times a producer runs", async () => {
      const u = await makeUser(db, "Dup User");
      for (let i = 0; i < 3; i++) {
        await db.query(`select public.push_notification($1, 'order_updated', 'Once', 'body', '{}'::jsonb, 'dup-key')`, [u]);
      }
      expect(await notesFor(u)).toHaveLength(1);
    });

    it("the same event key may exist for two different recipients", async () => {
      const a = await makeUser(db, "Key A");
      const b = await makeUser(db, "Key B");
      await db.query(`select public.push_notification($1, 'order_updated', 'Shared', null, '{}'::jsonb, 'shared-key'), public.push_notification($2, 'order_updated', 'Shared', null, '{}'::jsonb, 'shared-key')`, [a, b]);
      expect(await notesFor(a)).toHaveLength(1);
      expect(await notesFor(b)).toHaveLength(1);
    });
  });

  describe("M, N. order events derive the right recipients", () => {
    it("M. payment confirmed notifies the buyer and the personal seller — and nobody else", async () => {
      const seller = await makeUser(db, "Order Seller");
      const buyer = await makeUser(db, "Order Buyer");
      const bystander = await makeUser(db, "Order Bystander");
      const orderId = await paidOrder(await parentProduct(seller), buyer, 40000);

      const buyerNotes = await notesFor(buyer);
      const sellerNotes = await notesFor(seller);
      expect(buyerNotes.map((n) => [n.type, n.data])).toEqual([["payment_updated", { order_id: orderId, audience: "buyer" }]]);
      expect(sellerNotes.map((n) => [n.type, n.data])).toEqual([["payment_updated", { order_id: orderId, audience: "seller" }]]);
      expect(await notesFor(bystander)).toEqual([]);
    });

    it("N. a business order notifies the owner and every member of THAT business, never another business or a bystander", async () => {
      const biz = await businessWithStaff("Order Biz");
      const otherBiz = await businessWithStaff("Other Order Biz");
      const buyer = await makeUser(db, "Biz Order Buyer");
      const orderId = await paidOrder(await businessProduct(biz.businessId), buyer, 60000);

      for (const member of [biz.owner, biz.staff]) {
        const notes = await notesFor(member);
        expect(notes).toHaveLength(1);
        expect(notes[0].data).toEqual({ order_id: orderId, audience: "seller", business_id: biz.businessId });
      }
      expect(await notesFor(otherBiz.owner)).toEqual([]);
      expect(await notesFor(otherBiz.staff)).toEqual([]);
      expect((await notesFor(buyer)).map((n) => n.data)).toEqual([{ order_id: orderId, audience: "buyer" }]);
    });

    it("cash acceptance/decline and collection go to the buyer; a new cash order and a booked delivery go to the seller side", async () => {
      const seller = await makeUser(db, "Cash Seller");
      const buyer = await makeUser(db, "Cash Buyer");
      const orderId = await placeOnlineOrder(await parentProduct(seller), buyer);

      await emit(orderId, "cash_order.pending_seller_acceptance");
      await emit(orderId, "cash_order.accepted");
      await emit(orderId, "cash_order.declined");
      await emit(orderId, "collection.confirmed");
      await emit(orderId, "payment.failed", "payment");
      await emit(orderId, "delivery.booked", "delivery_order");

      expect(titles(await notesFor(seller)).sort()).toEqual(["Delivery booked", "New cash order"]);
      expect(titles(await notesFor(buyer)).sort()).toEqual(["Collection confirmed", "Delivery booked", "Order accepted", "Order declined", "Payment failed"]);
    });

    it("events that are not user-facing produce nothing", async () => {
      const seller = await makeUser(db, "Quiet Seller");
      const buyer = await makeUser(db, "Quiet Buyer");
      const orderId = await placeOnlineOrder(await parentProduct(seller), buyer);
      await emit(orderId, "order.created");
      await emit(orderId, "payment.initiated", "payment");
      await emit(orderId, "collection.attempt_failed", "collection_confirmation");
      await emit(orderId, "delivery.booking_failed", "delivery_order");
      expect(await notesFor(buyer)).toEqual([]);
      expect(await notesFor(seller)).toEqual([]);
    });

    it("real create_order → payment → confirm_collection produces the expected buyer notifications", async () => {
      const seller = await makeUser(db, "Flow Seller");
      const buyer = await makeUser(db, "Flow Buyer");
      const orderId = await paidOrder(await parentProduct(seller), buyer, 40000);
      const code = await db.query<{ collection_code: string }>(`select collection_code from public.collection_confirmations where order_id = $1`, [orderId]);
      await asUser(db, seller, () => db.query(`select public.confirm_collection($1, $2)`, [orderId, code.rows[0].collection_code]));
      expect(titles(await notesFor(buyer)).sort()).toEqual(["Collection confirmed", "Payment received"]);
    });
  });

  describe("Q. disputes", () => {
    it("opening notifies the seller side, the response notifies the buyer, resolution notifies both — and no reason, description or admin note appears", async () => {
      const biz = await businessWithStaff("Dispute Biz");
      const buyer = await makeUser(db, "Dispute Buyer");
      const orderId = await paidOrder(await businessProduct(biz.businessId), buyer, 60000);

      const disputeId = (
        await asUser(db, buyer, () =>
          db.query<{ open_dispute: string }>(`select public.open_dispute($1, 'item_not_as_described', $2)`, [orderId, "SECRET-DESCRIPTION-9f3a"]),
        )
      ).rows[0].open_dispute;
      await asUser(db, biz.staff, () => db.query(`select public.respond_to_dispute($1, $2)`, [disputeId, "SECRET-RESPONSE-77b1"]));
      await asUser(db, admin, () => db.query(`select public.resolve_dispute($1, 'resolved_buyer', $2)`, [disputeId, "SECRET-ADMIN-NOTE-c0de"]));

      expect(titles(await notesFor(buyer)).sort()).toEqual(["Dispute resolved", "Payment received", "Seller responded"]);
      for (const member of [biz.owner, biz.staff]) {
        expect(titles(await notesFor(member)).sort()).toEqual(["Dispute opened", "Dispute resolved", "Payment received"]);
      }

      const all = JSON.stringify([...(await notesFor(buyer)), ...(await notesFor(biz.owner)), ...(await notesFor(biz.staff))]);
      expect(all).not.toMatch(/SECRET-|item_not_as_described/);
    });
  });

  describe("L. messages", () => {
    async function openBusinessThread(buyer: string, businessId: string) {
      const product = await businessProduct(businessId);
      const t = await asUser(db, buyer, () =>
        db.query<{ id: string }>(
          `insert into public.message_threads (product_id, buyer_id, seller_type, business_id) values ($1, $2, 'business', $3) returning id`,
          [product, buyer, businessId],
        ),
      );
      return t.rows[0].id;
    }
    const say = (as: string, threadId: string, body: string) =>
      asUser(db, as, () => db.query(`insert into public.messages (thread_id, sender_id, body) values ($1, $2, $3)`, [threadId, as, body]));

    it("a message notifies only the other side, with no message body, and links to the right thread", async () => {
      const seller = await makeUser(db, "Msg Seller");
      const buyer = await makeUser(db, "Msg Buyer");
      const product = await parentProduct(seller);
      const thread = (
        await asUser(db, buyer, () =>
          db.query<{ id: string }>(`insert into public.message_threads (product_id, buyer_id, seller_type, seller_profile_id) values ($1, $2, 'parent', $3) returning id`, [product, buyer, seller]),
        )
      ).rows[0].id;

      await say(buyer, thread, "SECRET-MESSAGE-BODY-41d2 hello");

      const sellerNotes = await notesFor(seller);
      expect(sellerNotes).toHaveLength(1);
      expect(sellerNotes[0]).toMatchObject({ type: "message_received", title: "New message", data: { thread_id: thread } });
      expect(JSON.stringify(sellerNotes)).not.toMatch(/SECRET-MESSAGE/);
      expect(await notesFor(buyer)).toEqual([]);

      await say(seller, thread, "SECRET-REPLY-BODY-88aa hi back");
      const buyerNotes = await notesFor(buyer);
      expect(buyerNotes).toHaveLength(1);
      expect(JSON.stringify(buyerNotes)).not.toMatch(/SECRET-/);
    });

    it("a burst of messages produces one unread notification per conversation until it is read", async () => {
      const seller = await makeUser(db, "Burst Seller");
      const buyer = await makeUser(db, "Burst Buyer");
      const product = await parentProduct(seller);
      const thread = (
        await asUser(db, buyer, () =>
          db.query<{ id: string }>(`insert into public.message_threads (product_id, buyer_id, seller_type, seller_profile_id) values ($1, $2, 'parent', $3) returning id`, [product, buyer, seller]),
        )
      ).rows[0].id;

      await say(buyer, thread, "one");
      await say(buyer, thread, "two");
      await say(buyer, thread, "three");
      expect(await notesFor(seller)).toHaveLength(1);

      await asUser(db, seller, () => db.query(`update public.notifications set read_at = now() where profile_id = $1`, [seller]));
      await say(buyer, thread, "four");
      expect(await notesFor(seller)).toHaveLength(2);
    });

    it("N. a message to a business notifies its owner and members (with the business id), never another business", async () => {
      const biz = await businessWithStaff("Msg Biz");
      const otherBiz = await businessWithStaff("Other Msg Biz Two");
      const buyer = await makeUser(db, "Msg Biz Buyer");
      const thread = await openBusinessThread(buyer, biz.businessId);

      await say(buyer, thread, "hello business");
      for (const member of [biz.owner, biz.staff]) {
        const notes = await notesFor(member);
        expect(notes).toHaveLength(1);
        expect(notes[0].data).toEqual({ thread_id: thread, business_id: biz.businessId });
      }
      expect(await notesFor(otherBiz.owner)).toEqual([]);
      expect(await notesFor(otherBiz.staff)).toEqual([]);

      await say(biz.staff, thread, "reply from staff");
      const buyerNotes = await notesFor(buyer);
      expect(buyerNotes).toHaveLength(1);
      expect(buyerNotes[0].data).toEqual({ thread_id: thread });
    });
  });

  describe("O. verification", () => {
    it("an identity decision notifies only that user, with only the decision — never notes or the ID number", async () => {
      const applicant = await makeUser(db, "Idv Applicant", { verified: false });
      const other = await makeUser(db, "Idv Other", { verified: false });
      const submission = await db.query<{ id: string }>(
        `insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number) values ($1, 'manual', 'sa_id', 'x', $2) returning id`,
        [applicant, nextIdNumber()],
      );
      expect(await notesFor(applicant)).toEqual([]);

      await asUser(db, admin, () => db.query(`select public.review_identity_verification($1, 'rejected', $2)`, [submission.rows[0].id, "SECRET-REVIEW-NOTE-5e5e"]));
      const notes = await notesFor(applicant);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: "verification_updated", title: "Identity verification not approved", data: { kind: "identity", status: "rejected" } });
      expect(JSON.stringify(notes)).not.toMatch(/SECRET-|700101/);
      expect(await notesFor(other)).toEqual([]);
      expect(await notesFor(admin)).toEqual([]);
    });

    it("a business decision notifies the owner and members of that business only", async () => {
      const biz = await businessWithStaff("Verify Biz");
      const otherBiz = await businessWithStaff("Verify Other Biz");
      const submission = await db.query<{ id: string }>(
        `insert into public.business_verifications (business_id, document_type, document_storage_path) values ($1, 'registration', 'business/x/doc.pdf') returning id`,
        [biz.businessId],
      );
      await asUser(db, admin, () => db.query(`select public.review_business_verification($1, 'verified', $2)`, [submission.rows[0].id, "SECRET-BIZ-NOTE-1a1a"]));

      for (const member of [biz.owner, biz.staff]) {
        const notes = await notesFor(member);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ title: "Business verified", data: { kind: "business", status: "verified", business_id: biz.businessId } });
        expect(JSON.stringify(notes)).not.toMatch(/SECRET-/);
      }
      expect(await notesFor(otherBiz.owner)).toEqual([]);
    });
  });

  describe("P. payouts", () => {
    it("a paid payout notifies its recipient with no amount, and never anyone else", async () => {
      const seller = await makeUser(db, "Payout Seller");
      const other = await makeUser(db, "Payout Other");
      const payout = await db.query<{ id: string }>(
        `insert into public.payouts (recipient_type, recipient_profile_id, amount_cents, status, period_start, period_end)
         values ('parent', $1, 1234567, 'pending', now(), now()) returning id`,
        [seller],
      );
      await db.query(`update public.payouts set status = 'processing' where id = $1`, [payout.rows[0].id]);
      expect(await notesFor(seller)).toEqual([]);
      await db.query(`update public.payouts set status = 'paid', paid_at = now() where id = $1`, [payout.rows[0].id]);

      const notes = await notesFor(seller);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: "payout_updated", title: "Payout paid", data: {} });
      expect(JSON.stringify(notes)).not.toMatch(/1234567|12345\.67|R ?12/);
      expect(await notesFor(other)).toEqual([]);
    });

    it("a failed business payout notifies the business owner and members", async () => {
      const biz = await businessWithStaff("Payout Biz");
      const payout = await db.query<{ id: string }>(
        `insert into public.payouts (recipient_type, recipient_business_id, amount_cents, status, period_start, period_end)
         values ('business', $1, 99999, 'pending', now(), now()) returning id`,
        [biz.businessId],
      );
      await db.query(`update public.payouts set status = 'failed' where id = $1`, [payout.rows[0].id]);
      for (const member of [biz.owner, biz.staff]) {
        const notes = await notesFor(member);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ title: "Payout problem", data: { business_id: biz.businessId } });
      }
    });
  });

  describe("K, I. content, ordering and safety of the producers", () => {
    it("K. every notification produced has only whitelisted reference keys in data and bounded text", async () => {
      await db.query("reset role");
      const all = await db.query<Note>(`select profile_id, type, title, body, data, read_at, event_key from public.notifications`);
      expect(all.rows.length).toBeGreaterThan(10);
      for (const n of all.rows) {
        for (const key of Object.keys(n.data)) expect(ALLOWED_DATA_KEYS.has(key), `unexpected data key ${key} in ${n.title}`).toBe(true);
        expect(n.title.length).toBeLessThanOrEqual(120);
        expect((n.body ?? "").length).toBeLessThanOrEqual(300);
        expect(`${n.title} ${n.body}`).not.toMatch(/R\s?\d|cents|@|https?:|commission|margin|provider/i);
      }
    });

    it("I. notifications list newest first for the recipient", async () => {
      const u = await makeUser(db, "Order User");
      await db.query(
        `insert into public.notifications (profile_id, type, title, event_key, created_at) values
           ($1, 'order_updated', 'oldest', 'o1', now() - interval '3 days'),
           ($1, 'order_updated', 'newest', 'o3', now()),
           ($1, 'order_updated', 'middle', 'o2', now() - interval '1 day')`,
        [u],
      );
      const r = await asUser(db, u, () => db.query<{ title: string }>(`select title from public.notifications order by created_at desc, id desc limit 2`));
      expect(r.rows.map((x) => x.title)).toEqual(["newest", "middle"]);
    });

    it("a failing notification producer never aborts the underlying event (payments must not break)", async () => {
      const seller = await makeUser(db, "Failsafe Seller");
      const buyer = await makeUser(db, "Failsafe Buyer");
      const orderId = await placeOnlineOrder(await parentProduct(seller), buyer);
      await db.query(`alter table public.notifications add constraint tmp_break_all check (false) not valid`);
      try {
        await payOrder(orderId, 40000);
      } finally {
        await db.query(`alter table public.notifications drop constraint tmp_break_all`);
      }
      const status = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [orderId]);
      expect(status.rows[0].status).toBe("paid");
      expect(await notesFor(buyer)).toEqual([]);
    });
  });
});
