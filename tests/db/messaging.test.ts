import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 14B: buyer <-> seller/business messaging exercised against the real
 * migration SQL. message_threads/messages existed since the foundation
 * schema; 20261012090000_messaging_hardening.sql closes the gaps this file
 * proves: threads could be created naming ANY seller/business and any
 * (or no) product, there was no per-buyer-per-listing uniqueness, a
 * participant could rewrite any column of any message in a shared thread,
 * message timestamps/read state were client-settable, and nothing kept
 * last_message_at current.
 */
describe("messaging (Phase 14B)", () => {
  let db: PGlite;
  let buyer: string;
  let buyer2: string;
  let seller: string;
  let otherSeller: string;
  let bizOwner: string;
  let bizStaff: string;
  let otherBizOwner: string;
  let otherBizStaff: string;
  let bizId: string;
  let otherBizId: string;
  let categoryId: string;

  async function makeProduct(o: { seller?: string; business?: string; status?: "draft" | "published" | "archived" | "sold" }): Promise<string> {
    const status = o.status ?? "published";
    const r = o.business
      ? await db.query<{ id: string }>(
          `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status)
           values ('business', $1, $2, 'Biz Item', 'good', 5000, $3) returning id`,
          [o.business, categoryId, status],
        )
      : await db.query<{ id: string }>(
          `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
           values ('parent', $1, $2, 'Parent Item', 'good', 5000, $3) returning id`,
          [o.seller ?? seller, categoryId, status],
        );
    return r.rows[0].id;
  }

  type Target = { product: string | null; sellerType: "parent" | "business"; sellerProfile?: string | null; business?: string | null };

  const startThread = (as: string, t: Target, buyerId = as) =>
    asUser(db, as, () =>
      db.query<{ id: string }>(
        `insert into public.message_threads (product_id, buyer_id, seller_type, seller_profile_id, business_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [t.product, buyerId, t.sellerType, t.sellerProfile ?? null, t.business ?? null],
      ),
    );

  const parentTarget = (product: string, sellerProfile = seller): Target => ({ product, sellerType: "parent", sellerProfile });
  const bizTarget = (product: string, business = bizId): Target => ({ product, sellerType: "business", business });

  const send = (as: string, threadId: string, body: string, senderId = as) =>
    asUser(db, as, () => db.query(`insert into public.messages (thread_id, sender_id, body) values ($1, $2, $3) returning id`, [threadId, senderId, body]));

  async function openThread(as: string, t: Target): Promise<string> {
    return (await startThread(as, t)).rows[0].id;
  }

  const RLS = /row-level security|permission denied|violates/i;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    buyer = await makeUser(db, "Msg Buyer");
    buyer2 = await makeUser(db, "Msg Buyer Two");
    seller = await makeUser(db, "Msg Seller");
    otherSeller = await makeUser(db, "Msg Other Seller");
    bizOwner = await makeUser(db, "Msg Biz Owner");
    bizStaff = await makeUser(db, "Msg Biz Staff");
    otherBizOwner = await makeUser(db, "Msg Other Biz Owner");
    otherBizStaff = await makeUser(db, "Msg Other Biz Staff");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    bizId = (await db.query<{ id: string }>(`insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, 'Msg Biz', 'msg-biz', 'verified') returning id`, [bizOwner])).rows[0].id;
    otherBizId = (await db.query<{ id: string }>(`insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, 'Other Msg Biz', 'other-msg-biz', 'verified') returning id`, [otherBizOwner])).rows[0].id;
    await db.query(`insert into public.business_members (business_id, profile_id, role) values ($1, $2, 'staff'), ($3, $4, 'staff')`, [bizId, bizStaff, otherBizId, otherBizStaff]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("starting a conversation", () => {
    it("A. a signed-in buyer can start a conversation from an eligible personal listing", async () => {
      const p = await makeProduct({});
      expect((await startThread(buyer, parentTarget(p))).rows).toHaveLength(1);
    });

    it("A. and from an eligible business listing", async () => {
      const p = await makeProduct({ business: bizId });
      expect((await startThread(buyer, bizTarget(p))).rows).toHaveLength(1);
    });

    it("F. an anonymous visitor cannot create a conversation", async () => {
      const p = await makeProduct({});
      await expect(
        asAnon(db, () =>
          db.query(`insert into public.message_threads (product_id, buyer_id, seller_type, seller_profile_id) values ($1, $2, 'parent', $3)`, [p, buyer, seller]),
        ),
      ).rejects.toThrow();
    });

    it("J. a buyer cannot start a conversation as someone else — buyer_id must be the caller", async () => {
      const p = await makeProduct({});
      await expect(startThread(buyer, parentTarget(p), buyer2)).rejects.toThrow(RLS);
    });

    it("I. a buyer cannot inject a different seller's identity for a listing", async () => {
      const p = await makeProduct({ seller });
      await expect(startThread(buyer, parentTarget(p, otherSeller))).rejects.toThrow(RLS);
    });

    it("I. nor claim a business seller for a personal listing, nor a different business for a business listing", async () => {
      const personal = await makeProduct({ seller });
      await expect(startThread(buyer, bizTarget(personal))).rejects.toThrow(RLS);
      const biz = await makeProduct({ business: bizId });
      await expect(startThread(buyer, bizTarget(biz, otherBizId))).rejects.toThrow(RLS);
      await expect(startThread(buyer, parentTarget(biz, otherSeller))).rejects.toThrow(RLS);
    });

    it("M. listing context cannot be forged: a conversation with no listing is rejected", async () => {
      await expect(startThread(buyer, { product: null, sellerType: "parent", sellerProfile: seller })).rejects.toThrow(RLS);
    });

    it("N. a nonexistent listing cannot start a conversation", async () => {
      await expect(startThread(buyer, parentTarget("00000000-0000-4000-8000-000000000000"))).rejects.toThrow(RLS);
    });

    it("N. nor can a draft, archived, or sold listing", async () => {
      for (const status of ["draft", "archived", "sold"] as const) {
        const p = await makeProduct({ status });
        await expect(startThread(buyer, parentTarget(p)), status).rejects.toThrow(RLS);
      }
    });

    it("H. a personal seller cannot message themselves about their own listing", async () => {
      const p = await makeProduct({ seller });
      await expect(startThread(seller, parentTarget(p))).rejects.toThrow(RLS);
    });

    it("H. the owner of a business cannot message their own business's listing", async () => {
      const p = await makeProduct({ business: bizId });
      await expect(startThread(bizOwner, bizTarget(p))).rejects.toThrow(RLS);
    });

    it("H. nor can a business member (staff)", async () => {
      const p = await makeProduct({ business: bizId });
      await expect(startThread(bizStaff, bizTarget(p))).rejects.toThrow(RLS);
    });

    it("a member of a DIFFERENT business can message this business — it isn't their own listing", async () => {
      const p = await makeProduct({ business: bizId });
      expect((await startThread(otherBizOwner, bizTarget(p))).rows).toHaveLength(1);
    });
  });

  describe("reuse and duplicates", () => {
    it("Q. a second conversation for the same buyer and listing is rejected — one thread per buyer per listing", async () => {
      const p = await makeProduct({});
      await startThread(buyer, parentTarget(p));
      await expect(startThread(buyer, parentTarget(p))).rejects.toThrow(/duplicate key|unique/i);
    });

    it("Q. INSERT ... ON CONFLICT DO NOTHING (what the app uses) is a clean no-op that leaves exactly one thread", async () => {
      const p = await makeProduct({});
      const insert = () =>
        asUser(db, buyer, () =>
          db.query(
            `insert into public.message_threads (product_id, buyer_id, seller_type, seller_profile_id) values ($1, $2, 'parent', $3) on conflict (buyer_id, product_id) do nothing`,
            [p, buyer, seller],
          ),
        );
      await insert();
      await insert();
      await db.query("reset role");
      const r = await db.query(`select 1 from public.message_threads where buyer_id = $1 and product_id = $2`, [buyer, p]);
      expect(r.rows).toHaveLength(1);
    });

    it("R. concurrent conversation creation for the same buyer and listing yields exactly one thread", async () => {
      const p = await makeProduct({});
      const attempt = () =>
        asUser(db, buyer2, () =>
          db.query(
            `insert into public.message_threads (product_id, buyer_id, seller_type, seller_profile_id) values ($1, $2, 'parent', $3) on conflict (buyer_id, product_id) do nothing`,
            [p, buyer2, seller],
          ),
        ).catch(() => null);
      await Promise.all([attempt(), attempt(), attempt(), attempt()]);
      await db.query("reset role");
      const r = await db.query(`select 1 from public.message_threads where buyer_id = $1 and product_id = $2`, [buyer2, p]);
      expect(r.rows).toHaveLength(1);
    });

    it("different buyers each get their own conversation about the same listing", async () => {
      const p = await makeProduct({});
      await startThread(buyer, parentTarget(p));
      expect((await startThread(buyer2, parentTarget(p))).rows).toHaveLength(1);
    });
  });

  describe("participant access", () => {
    it("B. the buyer can read their own conversation, and the seller can read theirs", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      expect((await asUser(db, buyer, () => db.query(`select 1 from public.message_threads where id = $1`, [t]))).rows).toHaveLength(1);
      expect((await asUser(db, seller, () => db.query(`select 1 from public.message_threads where id = $1`, [t]))).rows).toHaveLength(1);
    });

    it("C. both participants can send messages in it", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      expect((await send(buyer, t, "Is this still available?")).rows).toHaveLength(1);
      expect((await send(seller, t, "Yes, collect tomorrow.")).rows).toHaveLength(1);
      const r = await asUser(db, buyer, () => db.query(`select body from public.messages where thread_id = $1 order by created_at`, [t]));
      expect(r.rows).toHaveLength(2);
    });

    it("D. another user cannot read someone else's conversation or its messages", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      await send(buyer, t, "private hello");
      expect((await asUser(db, buyer2, () => db.query(`select 1 from public.message_threads where id = $1`, [t]))).rows).toHaveLength(0);
      expect((await asUser(db, buyer2, () => db.query(`select 1 from public.messages where thread_id = $1`, [t]))).rows).toHaveLength(0);
      expect((await asUser(db, otherSeller, () => db.query(`select 1 from public.messages where thread_id = $1`, [t]))).rows).toHaveLength(0);
    });

    it("E. another user cannot send a message into someone else's conversation", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      await expect(send(buyer2, t, "intruder")).rejects.toThrow(RLS);
      await expect(send(otherSeller, t, "intruder")).rejects.toThrow(RLS);
    });

    it("G. an anonymous visitor cannot read conversations or messages", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      await send(buyer, t, "hello");
      expect((await asAnon(db, () => db.query(`select * from public.message_threads`))).rows).toHaveLength(0);
      expect((await asAnon(db, () => db.query(`select * from public.messages`))).rows).toHaveLength(0);
    });

    it("J. a sender cannot post as another user — sender_id must be the caller", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      await expect(send(buyer, t, "spoofed", seller)).rejects.toThrow(RLS);
    });

    it("conversations cannot be deleted or re-assigned by a participant", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      const del = await asUser(db, buyer, () => db.query(`delete from public.message_threads where id = $1`, [t]));
      expect(del.affectedRows).toBe(0);
      const upd = await asUser(db, buyer, () => db.query(`update public.message_threads set buyer_id = $2 where id = $1`, [t, buyer2])).catch(() => ({ affectedRows: 0 }));
      expect(upd.affectedRows).toBe(0);
    });
  });

  describe("business conversations", () => {
    it("L. the business owner and a business member can both read and reply to a business conversation", async () => {
      const p = await makeProduct({ business: bizId });
      const t = await openThread(buyer, bizTarget(p));
      await send(buyer, t, "Hi, still available?");
      for (const member of [bizOwner, bizStaff]) {
        expect((await asUser(db, member, () => db.query(`select 1 from public.messages where thread_id = $1`, [t]))).rows).toHaveLength(1);
      }
      expect((await send(bizStaff, t, "Yes!")).rows).toHaveLength(1);
      expect((await send(bizOwner, t, "Come by tomorrow.")).rows).toHaveLength(1);
    });

    it("K. an unrelated business's owner and member cannot read or write a business conversation", async () => {
      const p = await makeProduct({ business: bizId });
      const t = await openThread(buyer, bizTarget(p));
      await send(buyer, t, "hello");
      for (const outsider of [otherBizOwner, otherBizStaff, seller]) {
        expect((await asUser(db, outsider, () => db.query(`select 1 from public.message_threads where id = $1`, [t]))).rows).toHaveLength(0);
        expect((await asUser(db, outsider, () => db.query(`select 1 from public.messages where thread_id = $1`, [t]))).rows).toHaveLength(0);
        await expect(send(outsider, t, "intruder")).rejects.toThrow(RLS);
      }
    });

    it("a business member does not gain access to an unrelated PERSONAL conversation", async () => {
      const p = await makeProduct({ seller });
      const t = await openThread(buyer, parentTarget(p));
      expect((await asUser(db, bizStaff, () => db.query(`select 1 from public.message_threads where id = $1`, [t]))).rows).toHaveLength(0);
    });
  });

  describe("message content and database authority", () => {
    async function freshThread(): Promise<string> {
      return openThread(buyer, parentTarget(await makeProduct({})));
    }

    it("O. an empty message is rejected", async () => {
      const t = await freshThread();
      await expect(send(buyer, t, "")).rejects.toThrow(/check|violates/i);
    });

    it("O. and so is a whitespace-only message", async () => {
      const t = await freshThread();
      await expect(send(buyer, t, "   \n\t  ")).rejects.toThrow(/check|violates/i);
    });

    it("P. a message over the length limit is rejected, and exactly the limit is accepted", async () => {
      const t = await freshThread();
      await expect(send(buyer, t, "x".repeat(2001))).rejects.toThrow(/check|violates/i);
      expect((await send(buyer, t, "x".repeat(2000))).rows).toHaveLength(1);
    });

    it("timestamps are database-authoritative: a client cannot set created_at on a message", async () => {
      const t = await freshThread();
      await expect(
        asUser(db, buyer, () => db.query(`insert into public.messages (thread_id, sender_id, body, created_at) values ($1, $2, 'backdated', now() - interval '1 year')`, [t, buyer])),
      ).rejects.toThrow(RLS);
    });

    it("read state is database-authoritative: a client cannot insert a message as already read", async () => {
      const t = await freshThread();
      await expect(
        asUser(db, buyer, () => db.query(`insert into public.messages (thread_id, sender_id, body, read_at) values ($1, $2, 'pre-read', now())`, [t, buyer])),
      ).rejects.toThrow(RLS);
    });

    it("a participant cannot rewrite a message body or re-attribute its sender", async () => {
      const t = await freshThread();
      await send(buyer, t, "original");
      const edit = await asUser(db, seller, () => db.query(`update public.messages set body = 'tampered' where thread_id = $1`, [t])).catch(() => ({ affectedRows: 0 }));
      expect(edit.affectedRows).toBe(0);
      const reattribute = await asUser(db, buyer, () => db.query(`update public.messages set sender_id = $2 where thread_id = $1`, [t, seller])).catch(() => ({ affectedRows: 0 }));
      expect(reattribute.affectedRows).toBe(0);
      await db.query("reset role");
      const r = await db.query<{ body: string; sender_id: string }>(`select body, sender_id from public.messages where thread_id = $1`, [t]);
      expect(r.rows[0]).toEqual({ body: "original", sender_id: buyer });
    });

    it("read/unread: the RECIPIENT can mark a message read, but the sender cannot mark their own message read", async () => {
      const t = await freshThread();
      await send(buyer, t, "please read");
      const own = await asUser(db, buyer, () => db.query(`update public.messages set read_at = now() where thread_id = $1`, [t]));
      expect(own.affectedRows).toBe(0);
      const recipient = await asUser(db, seller, () => db.query(`update public.messages set read_at = now() where thread_id = $1`, [t]));
      expect(recipient.affectedRows).toBe(1);
    });

    it("an unrelated user cannot mark someone else's messages read", async () => {
      const t = await freshThread();
      await send(buyer, t, "hello");
      const r = await asUser(db, buyer2, () => db.query(`update public.messages set read_at = now() where thread_id = $1`, [t]));
      expect(r.affectedRows).toBe(0);
    });

    it("last_message_at is maintained by the database when a message is sent", async () => {
      const t = await freshThread();
      await db.query("reset role");
      await db.query(`update public.message_threads set last_message_at = now() - interval '1 day' where id = $1`, [t]);
      await send(buyer, t, "bump");
      await db.query("reset role");
      const r = await db.query<{ fresh: boolean }>(`select last_message_at > now() - interval '1 hour' as fresh from public.message_threads where id = $1`, [t]);
      expect(r.rows[0].fresh).toBe(true);
    });
  });

  describe("listing lifecycle", () => {
    it("an existing conversation keeps working after the listing is sold — history and replies continue", async () => {
      const p = await makeProduct({});
      const t = await openThread(buyer, parentTarget(p));
      await send(buyer, t, "before");
      await db.query(`update public.products set status = 'sold' where id = $1`, [p]);
      expect((await send(seller, t, "after sale")).rows).toHaveLength(1);
      expect((await asUser(db, buyer, () => db.query(`select 1 from public.messages where thread_id = $1`, [t]))).rows).toHaveLength(2);
    });

    it("if the listing is deleted the conversation and its messages survive, with the listing context cleared", async () => {
      const p = await makeProduct({ status: "published" });
      const t = await openThread(buyer, parentTarget(p));
      await send(buyer, t, "still here");
      await db.query("reset role");
      await db.query(`delete from public.products where id = $1`, [p]);
      const r = await asUser(db, buyer, () => db.query<{ product_id: string | null }>(`select product_id from public.message_threads where id = $1`, [t]));
      expect(r.rows[0].product_id).toBeNull();
      expect((await asUser(db, buyer, () => db.query(`select 1 from public.messages where thread_id = $1`, [t]))).rows).toHaveLength(1);
    });
  });

  describe("policy and grant shape", () => {
    it("messaging never opens a broad read: every SELECT/INSERT/UPDATE policy is participant-scoped, and no DELETE policy exists", async () => {
      await db.query("reset role");
      const r = await db.query<{ tablename: string; cmd: string; qual: string | null; with_check: string | null }>(
        `select tablename, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('message_threads', 'messages')`,
      );
      expect(r.rows.filter((row) => row.cmd === "DELETE")).toHaveLength(0);
      for (const row of r.rows) {
        const expression = `${row.qual ?? ""} ${row.with_check ?? ""}`;
        expect(expression, `${row.tablename} ${row.cmd}`).toMatch(/auth\.uid\(\)|is_business_member|is_admin/);
        expect(expression, `${row.tablename} ${row.cmd}`).not.toMatch(/^\s*true\s*$/);
      }
    });
  });
});
