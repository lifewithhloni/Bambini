import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 15B.1 — Reviews MVP, against the real migration SQL on real
 * Postgres. One review per COMPLETED order, written only by the order's
 * buyer through create_review(); the seller (parent or business) is derived
 * from the order; ratings are recomputed from visible rows; the public
 * representation (reviews_public) exposes neither reviewer nor order ids.
 *
 * Concurrency note (same limitation the other tests/db files document):
 * PGlite is a single connection, so "concurrent" calls queue rather than
 * truly interleave — the guarantee under test is UNIQUE(order_id) plus the
 * function's duplicate handling, which hold regardless of scheduling.
 */
describe("reviews (Phase 15B.1)", () => {
  let db: PGlite;
  let categoryId: string;
  let counter = 0;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.query("reset role");
  });

  // --- fixtures -------------------------------------------------------------
  async function parentProduct(seller: string, title = "Review toy") {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, $3, 'good', 50000, 'published', true, true) returning id`,
      [seller, categoryId, title],
    );
    return r.rows[0].id;
  }

  async function businessWithOwner(name = "Review Biz") {
    counter += 1;
    const owner = await makeUser(db, `${name} Owner`);
    const b = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, $2, $3, 'verified') returning id`,
      [owner, name, `review-biz-${counter}`],
    );
    return { owner, businessId: b.rows[0].id };
  }

  async function businessProduct(businessId: string, title = "Review biz toy") {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('business', $1, $2, $3, 'good', 50000, 'published', true, true) returning id`,
      [businessId, categoryId, title],
    );
    return r.rows[0].id;
  }

  async function placeOrder(buyer: string, productId: string) {
    const r = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
    return r.rows[0].order_id;
  }

  const complete = (orderId: string) => db.query(`update public.orders set status = 'completed', completed_at = now() where id = $1`, [orderId]);

  /** Parent-seller world: fresh seller + buyer + a COMPLETED order. */
  async function parentWorld(opts: { complete?: boolean; sellerName?: string; buyerName?: string } = {}) {
    const seller = await makeUser(db, opts.sellerName ?? "Rev Seller");
    const buyer = await makeUser(db, opts.buyerName ?? "Rev Buyer");
    const productId = await parentProduct(seller);
    const orderId = await placeOrder(buyer, productId);
    if (opts.complete !== false) await complete(orderId);
    return { seller, buyer, productId, orderId };
  }

  async function businessWorld(opts: { complete?: boolean } = {}) {
    const { owner, businessId } = await businessWithOwner();
    const staff = await makeUser(db, "Rev Staff");
    await db.query(`insert into public.business_members (business_id, profile_id, role) values ($1, $2, 'staff')`, [businessId, staff]);
    const buyer = await makeUser(db, "Rev Biz Buyer");
    const productId = await businessProduct(businessId);
    const orderId = await placeOrder(buyer, productId);
    if (opts.complete !== false) await complete(orderId);
    return { owner, staff, businessId, buyer, productId, orderId };
  }

  const review = (user: string, orderId: string, rating: unknown, comment: unknown = null) =>
    asUser(db, user, () => db.query<{ id: string }>(`select public.create_review($1, $2, $3) as id`, [orderId, rating, comment]));

  const rowFor = async (orderId: string) =>
    (await db.query<{ reviewer_id: string; seller_type: string; seller_profile_id: string | null; business_id: string | null; rating: number; comment: string | null; seller_response: string | null; hidden_at: string | null; created_at: string }>(
      `select reviewer_id, seller_type, seller_profile_id, business_id, rating, comment, seller_response, hidden_at, created_at from public.reviews where order_id = $1`,
      [orderId],
    )).rows[0];

  const parentRating = async (id: string) =>
    (await db.query<{ rating_average: string | null; rating_count: number }>(`select rating_average, rating_count from public.profiles where id = $1`, [id])).rows[0];
  const businessRating = async (id: string) =>
    (await db.query<{ rating_average: string | null; rating_count: number }>(`select rating_average, rating_count from public.businesses where id = $1`, [id])).rows[0];

  // --- 1/2. Legitimate reviews ------------------------------------------------
  describe("legitimate reviews", () => {
    it("1. a parent-seller buyer reviews a completed order; the seller is derived from the order and the cache updates", async () => {
      const w = await parentWorld();
      const r = await review(w.buyer, w.orderId, 5, "Lovely");
      expect(r.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await rowFor(w.orderId)).toMatchObject({
        reviewer_id: w.buyer, seller_type: "parent", seller_profile_id: w.seller, business_id: null, rating: 5, comment: "Lovely", seller_response: null, hidden_at: null,
      });
      expect(await parentRating(w.seller)).toEqual({ rating_average: "5.00", rating_count: 1 });
    });

    it("2. a business-seller buyer reviews a completed order; the rating lands on the business, not on any profile", async () => {
      const w = await businessWorld();
      await review(w.buyer, w.orderId, 4);
      expect(await rowFor(w.orderId)).toMatchObject({ seller_type: "business", seller_profile_id: null, business_id: w.businessId, rating: 4, comment: null });
      expect(await businessRating(w.businessId)).toEqual({ rating_average: "4.00", rating_count: 1 });
      expect(await parentRating(w.owner)).toEqual({ rating_average: null, rating_count: 0 });
    });

    it("a disputed order that resolves back to 'completed' becomes reviewable again (existing status semantics), once", async () => {
      const w = await parentWorld();
      await db.query(`update public.orders set status = 'disputed' where id = $1`, [w.orderId]);
      await expect(review(w.buyer, w.orderId, 5)).rejects.toThrow(/not completed/i);
      await db.query(`update public.orders set status = 'completed' where id = $1`, [w.orderId]); // dispute resolution restores the pre-dispute status
      await review(w.buyer, w.orderId, 5);
      await expect(review(w.buyer, w.orderId, 5)).rejects.toThrow(/already been reviewed/i);
    });
  });

  // --- 3. Direct writes ---------------------------------------------------------
  describe("direct client writes are gone", () => {
    it("3. a buyer cannot INSERT/UPDATE/DELETE reviews directly; anon cannot either", async () => {
      const w = await parentWorld();
      await asUser(db, w.buyer, async () => {
        await expect(
          db.query(`insert into public.reviews (order_id, reviewer_id, seller_type, seller_profile_id, rating) values ($1, $2, 'parent', $3, 5)`, [w.orderId, w.buyer, w.seller]),
        ).rejects.toThrow(/permission denied/i);
      });
      await review(w.buyer, w.orderId, 5);
      await asUser(db, w.buyer, async () => {
        await expect(db.query(`update public.reviews set rating = 1 where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`delete from public.reviews where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
      });
      await asAnon(db, async () => {
        await expect(db.query(`insert into public.reviews (order_id, reviewer_id, seller_type, seller_profile_id, rating) values ($1, $2, 'parent', $3, 5)`, [w.orderId, w.buyer, w.seller])).rejects.toThrow(/permission denied/i);
      });
    });

    it("the old insert policy is gone and the old select-all policy is gone", async () => {
      const r = await db.query<{ policyname: string }>(`select policyname from pg_policies where schemaname = 'public' and tablename = 'reviews' order by 1`);
      expect(r.rows.map((p) => p.policyname)).toEqual(["reviews_select_own_or_admin"]);
    });
  });

  // --- 4-7. Who may review -------------------------------------------------------
  describe("only the order's buyer may review", () => {
    it("4. a non-buyer is denied, with the same answer as a non-existent order", async () => {
      const w = await parentWorld();
      const stranger = await makeUser(db, "Rev Stranger");
      await expect(review(stranger, w.orderId, 5)).rejects.toThrow(/Order not found/);
      await expect(review(stranger, "00000000-0000-0000-0000-000000000000", 5)).rejects.toThrow(/Order not found/);
    });

    it("5. the seller cannot review their own sale", async () => {
      const w = await parentWorld();
      await expect(review(w.seller, w.orderId, 5)).rejects.toThrow(/Order not found/);
    });

    it("6. business owner and staff cannot review their business's order (membership is not buyer identity)", async () => {
      const w = await businessWorld();
      await expect(review(w.owner, w.orderId, 5)).rejects.toThrow(/Order not found/);
      await expect(review(w.staff, w.orderId, 5)).rejects.toThrow(/Order not found/);
      expect(await rowFor(w.orderId)).toBeUndefined();
    });

    it("a business member who is independently the BUYER of another seller's order can review it", async () => {
      const seller = await makeUser(db, "Indep Seller");
      const { staff } = await businessWorld();
      const productId = await parentProduct(seller, "Indep toy");
      const orderId = await placeOrder(staff, productId);
      await complete(orderId);
      await review(staff, orderId, 3);
      expect(await rowFor(orderId)).toMatchObject({ reviewer_id: staff, seller_profile_id: seller });
    });

    it("7. anonymous callers cannot execute create_review at all", async () => {
      const w = await parentWorld();
      await asAnon(db, async () => {
        await expect(db.query(`select public.create_review($1, 5, null)`, [w.orderId])).rejects.toThrow(/permission denied/i);
      });
    });
  });

  // --- 8-13. Forgery is structurally impossible ------------------------------------
  describe("seller/reviewer identity cannot be forged", () => {
    it("8-12. create_review accepts exactly (order, rating, comment) — there is no parameter for reviewer, seller, business, seller_type, product, seller_response, created_at or hidden_at", async () => {
      const args = await db.query<{ args: string }>(`select pg_get_function_arguments('public.create_review(uuid, integer, text)'::regprocedure) as args`);
      expect(args.rows[0].args).toBe("p_order_id uuid, p_rating integer, p_comment text DEFAULT NULL::text");

      const w = await parentWorld();
      const other = await makeUser(db, "Forgery Target");
      for (const extra of ["p_reviewer_id", "p_seller_profile_id", "p_business_id", "p_seller_type", "p_product_id", "p_seller_response", "p_created_at", "p_hidden_at"]) {
        await asUser(db, w.buyer, async () => {
          await expect(
            db.query(`select public.create_review(p_order_id => $1, p_rating => 5, ${extra} => $2)`, [w.orderId, other]),
          ).rejects.toThrow(/does not exist|function/i);
        });
      }
      expect(await rowFor(w.orderId)).toBeUndefined();
    });

    it("12/13. the stored seller always comes from the order, the product relationship is the order's, and an unrelated seller is never rated", async () => {
      const w = await parentWorld();
      const unrelated = await makeUser(db, "Unrelated Seller");
      const unrelatedBiz = await businessWithOwner("Unrelated Biz");
      await review(w.buyer, w.orderId, 1, "Awful");
      const row = await rowFor(w.orderId);
      expect(row.seller_profile_id).toBe(w.seller);
      expect(row.seller_profile_id).not.toBe(unrelated);
      expect(await parentRating(unrelated)).toEqual({ rating_average: null, rating_count: 0 });
      expect(await businessRating(unrelatedBiz.businessId)).toEqual({ rating_average: null, rating_count: 0 });

      const product = await db.query<{ product_id: string }>(
        `select oi.product_id from public.reviews r join public.order_items oi on oi.order_id = r.order_id where r.order_id = $1`,
        [w.orderId],
      );
      expect(product.rows).toEqual([{ product_id: w.productId }]);
      const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema='public' and table_name='reviews'`);
      expect(cols.rows.map((c) => c.column_name)).not.toContain("product_id");
    });
  });

  // --- 14-17. Eligibility and duplicates -----------------------------------------------
  describe("eligibility and duplicates", () => {
    it("14. incomplete orders are denied (every non-completed status, and completed without completed_at)", async () => {
      for (const status of ["pending_payment", "confirmed", "ready_for_collection", "awaiting_delivery", "in_transit", "cancelled", "refunded"]) {
        const w = await parentWorld({ complete: false });
        await db.query(`update public.orders set status = $2 where id = $1`, [w.orderId, status]);
        await expect(review(w.buyer, w.orderId, 5), status).rejects.toThrow(/not completed/i);
      }
      const w = await parentWorld();
      await db.query(`update public.orders set completed_at = null where id = $1`, [w.orderId]);
      await expect(review(w.buyer, w.orderId, 5)).rejects.toThrow(/not completed/i);
    });

    it("15. a disputed order is denied", async () => {
      const w = await parentWorld();
      await db.query(`update public.orders set status = 'disputed' where id = $1`, [w.orderId]);
      await expect(review(w.buyer, w.orderId, 5)).rejects.toThrow(/not completed/i);
    });

    it("16. a second review of the same order is denied with a clear message", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5);
      await expect(review(w.buyer, w.orderId, 1)).rejects.toThrow(/Order has already been reviewed/);
      expect((await db.query(`select count(*)::int as n from public.reviews where order_id = $1`, [w.orderId])).rows[0]).toEqual({ n: 1 });
    });

    it("17. concurrent duplicate requests produce exactly one review; UNIQUE(order_id) backs it at the table level", async () => {
      const w = await parentWorld();
      const results = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => review(w.buyer, w.orderId, (i % 5) + 1)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x) => x.status === "rejected")) {
        expect(String((r as PromiseRejectedResult).reason.message)).toMatch(/already been reviewed/i);
      }
      expect((await db.query(`select count(*)::int as n from public.reviews where order_id = $1`, [w.orderId])).rows[0]).toEqual({ n: 1 });
      await expect(
        db.query(`insert into public.reviews (order_id, reviewer_id, seller_type, seller_profile_id, rating) values ($1, $2, 'parent', $3, 3)`, [w.orderId, w.buyer, w.seller]),
      ).rejects.toThrow(/reviews_order_id_key|duplicate key/i);
      expect(await parentRating(w.seller)).toMatchObject({ rating_count: 1 });
    });
  });

  // --- 18-21. Rating validation ------------------------------------------------------------
  describe("rating validation", () => {
    it.each([
      [0, "0"],
      [6, "6"],
      [-1, "negative"],
      [100, "100"],
    ])("rejects rating %s (%s)", async (rating) => {
      const w = await parentWorld();
      await expect(review(w.buyer, w.orderId, rating)).rejects.toThrow(/Invalid rating/);
      expect(await rowFor(w.orderId)).toBeUndefined();
    });

    it("20. rejects a decimal rating", async () => {
      const w = await parentWorld();
      await expect(review(w.buyer, w.orderId, 4.5)).rejects.toThrow();
      expect(await rowFor(w.orderId)).toBeUndefined();
    });

    it("21. rejects a null rating", async () => {
      const w = await parentWorld();
      await expect(review(w.buyer, w.orderId, null)).rejects.toThrow(/Invalid rating/);
    });

    it("accepts every integer 1-5", async () => {
      for (const rating of [1, 2, 3, 4, 5]) {
        const w = await parentWorld();
        await review(w.buyer, w.orderId, rating);
        expect((await rowFor(w.orderId)).rating).toBe(rating);
      }
    });

    it("the table itself still enforces 1-5 (database stays authoritative)", async () => {
      const w = await parentWorld();
      for (const rating of [0, 6]) {
        await expect(
          db.query(`insert into public.reviews (order_id, reviewer_id, seller_type, seller_profile_id, rating) values ($1, $2, 'parent', $3, $4)`, [w.orderId, w.buyer, w.seller, rating]),
        ).rejects.toThrow(/reviews_rating_check/);
      }
    });
  });

  // --- 22-26. Comment validation --------------------------------------------------------------
  describe("comment validation", () => {
    it("22. rejects an empty comment", async () => {
      const w = await parentWorld();
      await expect(review(w.buyer, w.orderId, 5, "")).rejects.toThrow(/Invalid comment/);
    });

    it("23. rejects a whitespace-only comment (spaces, tabs, newlines)", async () => {
      const w = await parentWorld();
      for (const c of ["   ", "\t\t", "\n\n", " \t\r\n "]) {
        await expect(review(w.buyer, w.orderId, 5, c)).rejects.toThrow(/Invalid comment/);
      }
      expect(await rowFor(w.orderId)).toBeUndefined();
    });

    it("24. rejects a comment over 1000 characters, without truncating", async () => {
      const w = await parentWorld();
      await expect(review(w.buyer, w.orderId, 5, "a".repeat(1001))).rejects.toThrow(/Invalid comment/);
      expect(await rowFor(w.orderId)).toBeUndefined();
    });

    it("25. accepts exactly 1000 characters (counted as characters, not bytes) and stores it intact", async () => {
      const w = await parentWorld();
      const thousand = "é".repeat(1000);
      await review(w.buyer, w.orderId, 5, thousand);
      expect((await rowFor(w.orderId)).comment).toBe(thousand);
    });

    it("trims surrounding whitespace before storing; an omitted or null comment is stored as NULL", async () => {
      const a = await parentWorld();
      await review(a.buyer, a.orderId, 5, "  \n great seller \t ");
      expect((await rowFor(a.orderId)).comment).toBe("great seller");
      const b = await parentWorld();
      await asUser(db, b.buyer, () => db.query(`select public.create_review($1, 4)`, [b.orderId]));
      expect((await rowFor(b.orderId)).comment).toBeNull();
      const c = await parentWorld();
      await review(c.buyer, c.orderId, 4, null);
      expect((await rowFor(c.orderId)).comment).toBeNull();
    });

    it("26. script/HTML text is stored as plain text, verbatim", async () => {
      const w = await parentWorld();
      const s = `<script>alert("x")</script> & <b>bold</b>`;
      await review(w.buyer, w.orderId, 5, s);
      expect((await rowFor(w.orderId)).comment).toBe(s);
    });

    it("the table-level constraint rejects untrimmed, empty or oversized comments even from a privileged insert", async () => {
      const w = await parentWorld();
      for (const comment of [" padded ", "", "x".repeat(1001)]) {
        await expect(
          db.query(`insert into public.reviews (order_id, reviewer_id, seller_type, seller_profile_id, rating, comment) values ($1, $2, 'parent', $3, 5, $4)`, [w.orderId, w.buyer, w.seller, comment]),
        ).rejects.toThrow(/reviews_comment_valid/);
      }
    });

    it("errors never echo the comment or any identifier", async () => {
      const w = await parentWorld();
      const secret = "SECRET-COMMENT-TEXT";
      for (const [rating, comment] of [[9, secret], [5, secret + " ".repeat(5) + "x".repeat(1100)]] as const) {
        try {
          await review(w.buyer, w.orderId, rating, comment);
          throw new Error("expected rejection");
        } catch (e) {
          const m = (e as Error).message;
          expect(m).not.toContain(secret);
          expect(m).not.toContain(w.buyer);
          expect(m).not.toContain(w.orderId);
        }
      }
    });
  });

  // --- 27-29. Reserved columns -------------------------------------------------------------------
  describe("reserved columns are not client-controllable", () => {
    it("27. seller_response cannot be supplied or written by anyone but the database owner", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5);
      expect((await rowFor(w.orderId)).seller_response).toBeNull();
      for (const who of [w.buyer, w.seller]) {
        await asUser(db, who, async () => {
          await expect(db.query(`update public.reviews set seller_response = 'fake' where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
          await expect(db.query(`select seller_response from public.reviews where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
        });
      }
    });

    it("28. created_at is the database's clock — a buyer cannot supply or change it", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5);
      const age = await db.query<{ seconds: number }>(`select extract(epoch from (now() - created_at))::float as seconds from public.reviews where order_id = $1`, [w.orderId]);
      expect(age.rows[0].seconds).toBeLessThan(30);
      expect(age.rows[0].seconds).toBeGreaterThanOrEqual(0);
      await asUser(db, w.buyer, async () => {
        await expect(db.query(`update public.reviews set created_at = '2001-01-01' where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
      });
    });

    it("29. hidden_at is NULL on creation and not writable or readable by the buyer", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5);
      expect((await rowFor(w.orderId)).hidden_at).toBeNull();
      await asUser(db, w.buyer, async () => {
        await expect(db.query(`update public.reviews set hidden_at = now() where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select hidden_at from public.reviews where order_id = $1`, [w.orderId])).rejects.toThrow(/permission denied/i);
      });
    });
  });

  // --- 30-33. Aggregates ----------------------------------------------------------------------------
  describe("rating aggregates are recomputed from visible reviews", () => {
    async function manyOrders(seller: string, buyer: string, n: number) {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const orderId = await placeOrder(buyer, await parentProduct(seller, `Agg toy ${i}`));
        await complete(orderId);
        ids.push(orderId);
      }
      return ids;
    }

    it("30. parent seller: first review sets count 1 / average = rating", async () => {
      const w = await parentWorld();
      expect(await parentRating(w.seller)).toEqual({ rating_average: null, rating_count: 0 });
      await review(w.buyer, w.orderId, 3);
      expect(await parentRating(w.seller)).toEqual({ rating_average: "3.00", rating_count: 1 });
    });

    it("31. business seller aggregates accumulate on the business", async () => {
      const w = await businessWorld();
      const o2 = await placeOrder(w.buyer, await businessProduct(w.businessId, "Biz agg 2"));
      await complete(o2);
      await review(w.buyer, w.orderId, 5);
      await review(w.buyer, o2, 2);
      expect(await businessRating(w.businessId)).toEqual({ rating_average: "3.50", rating_count: 2 });
    });

    it("32. multiple reviews give the exact average with no cumulative rounding drift (5,4,4 -> 4.33; 1..5 mix)", async () => {
      const seller = await makeUser(db, "Agg Seller");
      const buyer = await makeUser(db, "Agg Buyer");
      const orders = await manyOrders(seller, buyer, 7);
      const ratings = [5, 4, 4, 1, 2, 5, 3];
      let sum = 0;
      for (let i = 0; i < orders.length; i++) {
        await review(buyer, orders[i], ratings[i]);
        sum += ratings[i];
        const expected = (Math.round((sum / (i + 1)) * 100) / 100).toFixed(2);
        expect(await parentRating(seller), `after ${i + 1} reviews`).toEqual({ rating_average: expected, rating_count: i + 1 });
      }
      const truth = await db.query<{ avg: string; n: number }>(`select round(avg(rating)::numeric, 2)::text as avg, count(*)::int as n from public.reviews where seller_profile_id = $1`, [seller]);
      const cache = await parentRating(seller);
      expect({ rating_average: cache.rating_average, rating_count: cache.rating_count }).toEqual({ rating_average: truth.rows[0].avg, rating_count: truth.rows[0].n });
    });

    it("33. a hidden review is excluded from the average and count, and restored when unhidden (moderation-ready)", async () => {
      const seller = await makeUser(db, "Hide Seller");
      const buyer = await makeUser(db, "Hide Buyer");
      const [o1, o2, o3] = await manyOrders(seller, buyer, 3);
      await review(buyer, o1, 5);
      await review(buyer, o2, 4);
      await review(buyer, o3, 1);
      expect(await parentRating(seller)).toEqual({ rating_average: "3.33", rating_count: 3 });

      await db.query(`update public.reviews set hidden_at = now() where order_id = $1`, [o3]);
      expect(await parentRating(seller)).toEqual({ rating_average: "4.50", rating_count: 2 });

      await db.query(`update public.reviews set hidden_at = now() where order_id in ($1, $2)`, [o1, o2]);
      expect(await parentRating(seller)).toEqual({ rating_average: null, rating_count: 0 });

      await db.query(`update public.reviews set hidden_at = null where order_id = $1`, [o3]);
      expect(await parentRating(seller)).toEqual({ rating_average: "1.00", rating_count: 1 });
    });

    it("hiding a business review recomputes the business cache", async () => {
      const w = await businessWorld();
      await review(w.buyer, w.orderId, 2);
      await db.query(`update public.reviews set hidden_at = now() where order_id = $1`, [w.orderId]);
      expect(await businessRating(w.businessId)).toEqual({ rating_average: null, rating_count: 0 });
    });

    it("a privileged DELETE also recomputes (future-proofing), and the cache functions are not callable by clients", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5);
      await db.query(`delete from public.reviews where order_id = $1`, [w.orderId]);
      expect(await parentRating(w.seller)).toEqual({ rating_average: null, rating_count: 0 });
      await asUser(db, w.buyer, async () => {
        await expect(db.query(`select public.recompute_seller_rating('parent', $1, null)`, [w.seller])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select public.apply_review_to_seller_rating()`)).rejects.toThrow(/permission denied/i);
      });
    });
  });

  // --- 34-36. Public representation -------------------------------------------------------------------
  describe("public representation (reviews_public)", () => {
    it("34. hidden reviews do not appear in the public view", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5, "visible?");
      const before = await asAnon(db, () => db.query(`select comment from public.reviews_public where seller_profile_id = $1`, [w.seller]));
      expect(before.rows).toEqual([{ comment: "visible?" }]);
      await db.query(`update public.reviews set hidden_at = now() where order_id = $1`, [w.orderId]);
      const after = await asAnon(db, () => db.query(`select comment from public.reviews_public where seller_profile_id = $1`, [w.seller]));
      expect(after.rows).toEqual([]);
    });

    it("35/36. the view exposes no reviewer id and no order id; only the intended public fields", async () => {
      const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reviews_public' order by ordinal_position`);
      expect(cols.rows.map((c) => c.column_name)).toEqual(["id", "seller_type", "seller_profile_id", "business_id", "rating", "comment", "created_at", "reviewer_name"]);
      expect(cols.rows.map((c) => c.column_name)).not.toContain("reviewer_id");
      expect(cols.rows.map((c) => c.column_name)).not.toContain("order_id");
      expect(cols.rows.map((c) => c.column_name)).not.toContain("hidden_at");
      expect(cols.rows.map((c) => c.column_name)).not.toContain("seller_response");
    });

    it("35. anon and other users cannot reach reviewer/order ids through the base table", async () => {
      const w = await parentWorld();
      const stranger = await makeUser(db, "Peeping Stranger");
      await review(w.buyer, w.orderId, 5, "private ids");
      await asAnon(db, async () => {
        await expect(db.query(`select reviewer_id, order_id from public.reviews`)).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select count(*) from public.reviews`)).rejects.toThrow(/permission denied/i);
      });
      const strangerRows = await asUser(db, stranger, () => db.query(`select id from public.reviews where order_id = $1`, [w.orderId]));
      expect(strangerRows.rows).toEqual([]);
      const sellerRows = await asUser(db, w.seller, () => db.query(`select id from public.reviews where order_id = $1`, [w.orderId]));
      expect(sellerRows.rows).toEqual([]);
      const own = await asUser(db, w.buyer, () => db.query<{ rating: number; comment: string }>(`select rating, comment from public.reviews where order_id = $1`, [w.orderId]));
      expect(own.rows).toEqual([{ rating: 5, comment: "private ids" }]);
    });

    it("reviewer_name is first name + last initial (never the full name), with safe fallbacks", async () => {
      const cases: Array<[string, string]> = [
        ["Thandi Nkosi", "Thandi N."],
        ["Mary Jane van der Merwe", "Mary M."],
        ["Cher", "Cher"],
        ["   ", "Bambini member"],
      ];
      for (const [fullName, expected] of cases) {
        const w = await parentWorld({ buyerName: "placeholder" });
        await db.query(`update public.profiles set full_name = $2 where id = $1`, [w.buyer, fullName]);
        await review(w.buyer, w.orderId, 5);
        const r = await asAnon(db, () => db.query<{ reviewer_name: string }>(`select reviewer_name from public.reviews_public where seller_profile_id = $1`, [w.seller]));
        expect(r.rows[0].reviewer_name).toBe(expected);
      }
    });

    it("the view is read-only for clients", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 5);
      await asUser(db, w.buyer, async () => {
        // Either the missing privilege or the view not being updatable stops it; both are a refusal.
        await expect(db.query(`update public.reviews_public set rating = 1`)).rejects.toThrow(/permission denied|cannot update view/i);
        await expect(db.query(`delete from public.reviews_public`)).rejects.toThrow(/permission denied|cannot delete from view/i);
      });
    });
  });

  // --- 37-40. Interactions -----------------------------------------------------------------------------
  describe("interactions", () => {
    it("37. a product sold/archived after the review does not invalidate it or the rating", async () => {
      const w = await parentWorld();
      await review(w.buyer, w.orderId, 4, "Still valid");
      for (const status of ["sold", "archived"]) {
        await db.query(`update public.products set status = $2 where id = $1`, [w.productId, status]);
        const r = await asAnon(db, () => db.query(`select comment from public.reviews_public where seller_profile_id = $1`, [w.seller]));
        expect(r.rows).toEqual([{ comment: "Still valid" }]);
        expect(await parentRating(w.seller)).toEqual({ rating_average: "4.00", rating_count: 1 });
      }
    });

    it("38. cash eligibility sees the resulting rating: no reviews fails min_rating_average; good reviews can satisfy it; low or hidden ones do not", async () => {
      const eligibility = async (seller: string) =>
        (await db.query<{ eligible: boolean; failed_criteria: string[] }>(`select * from public.evaluate_cash_eligibility('parent', $1, null)`, [seller])).rows[0];

      async function seller3(ratings: [number, number, number]) {
        const seller = await makeUser(db, "Cash Seller");
        await db.query(`update public.profiles set account_verification = 'verified', identity_verification = 'verified' where id = $1`, [seller]);
        const buyer = await makeUser(db, "Cash Buyer");
        const orders: string[] = [];
        for (let i = 0; i < 3; i++) {
          const o = await placeOrder(buyer, await parentProduct(seller, `Cash toy ${i}`));
          await complete(o);
          orders.push(o);
        }
        return { seller, buyer, orders, ratings };
      }

      const good = await seller3([5, 5, 3]);
      expect((await eligibility(good.seller)).failed_criteria).toContain("min_rating_average");
      for (let i = 0; i < 3; i++) await review(good.buyer, good.orders[i], good.ratings[i]);
      expect(await eligibility(good.seller)).toEqual({ eligible: true, failed_criteria: [] });

      const low = await seller3([3, 3, 4]);
      for (let i = 0; i < 3; i++) await review(low.buyer, low.orders[i], low.ratings[i]);
      const lowResult = await eligibility(low.seller);
      expect(lowResult.eligible).toBe(false);
      expect(lowResult.failed_criteria).toEqual(["min_rating_average"]);

      // Hiding the best reviews drops a previously-eligible seller back below the bar.
      await db.query(`update public.reviews set hidden_at = now() where order_id = any($1) and rating = 5`, [good.orders]);
      expect((await eligibility(good.seller)).failed_criteria).toContain("min_rating_average");
    });

    it("39. creating a review creates no notification and no transaction event", async () => {
      const w = await parentWorld();
      const count = async () =>
        (await db.query<{ n: number }>(`select ((select count(*) from public.notifications) + (select count(*) from public.transaction_events))::int as n`)).rows[0].n;
      const before = await count();
      await review(w.buyer, w.orderId, 5, "quiet");
      expect(await count()).toBe(before);
    });

    it("40. create_review's error text is static (no SQL internals, no identifiers) for every rejection path", async () => {
      const w = await parentWorld();
      const stranger = await makeUser(db, "Err Stranger");
      const messages: string[] = [];
      for (const attempt of [
        () => review(stranger, w.orderId, 5),
        () => review(w.buyer, w.orderId, 0),
        () => review(w.buyer, w.orderId, 5, "   "),
        () => asAnon(db, () => db.query(`select public.create_review($1, 5, null)`, [w.orderId])),
      ]) {
        try {
          await attempt();
        } catch (e) {
          messages.push((e as Error).message);
        }
      }
      expect(messages).toHaveLength(4);
      for (const m of messages) {
        expect(m).not.toContain(w.orderId);
        expect(m).not.toContain(w.buyer);
        expect(m).not.toContain(w.seller);
        expect(m).not.toMatch(/SQLSTATE|PL\/pgSQL|CONTEXT/i);
      }
    });
  });

  // --- Function/privilege hygiene -------------------------------------------------------------------------
  describe("function hygiene", () => {
    it("create_review is SECURITY DEFINER with a fixed search_path; EXECUTE is authenticated-only", async () => {
      const f = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(`select prosecdef, proconfig from pg_proc where oid = 'public.create_review(uuid, integer, text)'::regprocedure`);
      expect(f.rows[0].prosecdef).toBe(true);
      expect(f.rows[0].proconfig).toContain("search_path=public");
      const priv = await db.query<{ anon: boolean; auth: boolean; pub: boolean }>(
        `select has_function_privilege('anon', 'public.create_review(uuid, integer, text)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.create_review(uuid, integer, text)', 'execute') as auth,
                has_function_privilege('public', 'public.create_review(uuid, integer, text)', 'execute') as pub`,
      );
      expect(priv.rows[0]).toEqual({ anon: false, auth: true, pub: false });
    });

    it("the rating trigger functions are SECURITY DEFINER with a fixed search_path", async () => {
      const f = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `select proname, prosecdef, proconfig from pg_proc where proname in ('apply_review_to_seller_rating', 'recompute_seller_rating') order by proname`,
      );
      expect(f.rows).toHaveLength(2);
      for (const row of f.rows) {
        expect(row.prosecdef, row.proname).toBe(true);
        expect(row.proconfig, row.proname).toContain("search_path=public");
      }
    });

    it("clients hold no write privilege on reviews and no access to the reserved columns", async () => {
      const p = await db.query<{ priv: string; who: string; ok: boolean }>(
        `select p as priv, r as who, has_table_privilege(r, 'public.reviews', p) as ok
         from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p, unnest(array['anon','authenticated']) r`,
      );
      expect(p.rows.filter((r) => r.ok)).toEqual([]);
      const c = await db.query<{ col: string; ok: boolean }>(
        `select c as col, has_column_privilege('authenticated', 'public.reviews', c, 'SELECT') as ok from unnest(array['hidden_at','seller_response']) c`,
      );
      expect(c.rows.filter((r) => r.ok)).toEqual([]);
    });
  });
});
