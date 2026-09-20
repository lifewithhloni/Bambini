import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Exercises the actual RLS policies in supabase/migrations/*_rls_policies.sql
 * against a real Postgres engine, as the `anon` and `authenticated` roles
 * PostgREST would actually use — not just reading the policy SQL. See
 * ARCHITECTURE.md#authorization--rls-architecture for the design this
 * verifies.
 *
 * A note on method: an UPDATE/DELETE blocked by RLS does not throw in
 * Postgres — it just matches 0 rows, exactly like a WHERE clause that
 * matches nothing. Every "cannot modify" assertion here checks
 * affectedRows === 0 (and, for the money-moving ones, re-reads the row as
 * postgres afterwards to confirm it's genuinely unchanged), not whether
 * the statement threw. An INSERT with no matching policy does throw
 * ("new row violates row-level security policy"), which is what the
 * "cannot forge" assertions check instead.
 */
describe("RLS policies", () => {
  let db: PGlite;
  let alice: string; // buyer
  let bob: string; // seller, owns an order with Alice
  let carol: string; // unrelated seller
  let orderId: string;
  let paymentId: string;
  let commissionId: string;
  let collectionConfirmationId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    alice = await makeUser(db, "Alice Buyer");
    bob = await makeUser(db, "Bob Seller");
    carol = await makeUser(db, "Carol OtherSeller");

    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    const bobLoc = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city, formatted_address)
       values ($1, -33.9, 18.4, 'Gardens', 'Cape Town', '12 Real Street, Gardens') returning id`,
      [bob],
    );
    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
       values ('parent', $1, $2, 'Bob Toy', 'good', 10000, $3, 'active')`,
      [bob, cat.rows[0].id, bobLoc.rows[0].id],
    );
    const carolLoc = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, -33.9, 18.5, 'Woodstock', 'Cape Town') returning id`,
      [carol],
    );
    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
       values ('parent', $1, $2, 'Carol Toy', 'good', 20000, $3, 'active')`,
      [carol, cat.rows[0].id, carolLoc.rows[0].id],
    );

    const order = await db.query<{ id: string }>(
      `insert into public.orders (buyer_id, seller_type, seller_profile_id, fulfilment_type, payment_method, status, subtotal_cents, total_cents, commission_rate_bps, commission_amount_cents)
       values ($1, 'parent', $2, 'collection', 'cash', 'confirmed', 10000, 10000, 1200, 1200) returning id`,
      [alice, bob],
    );
    orderId = order.rows[0].id;

    const payment = await db.query<{ id: string }>(
      `insert into public.payments (order_id, method, status, amount_cents) values ($1, 'cash', 'pending', 10000) returning id`,
      [orderId],
    );
    paymentId = payment.rows[0].id;

    const commission = await db.query<{ id: string }>(
      `insert into public.commissions (order_id, seller_type, rate_bps, base_amount_cents, commission_amount_cents) values ($1, 'parent', 1200, 10000, 1200) returning id`,
      [orderId],
    );
    commissionId = commission.rows[0].id;

    const cc = await db.query<{ id: string }>(
      `insert into public.collection_confirmations (order_id, collection_code) values ($1, 'ABC123') returning id`,
      [orderId],
    );
    collectionConfirmationId = cc.rows[0].id;

    await db.query(
      `insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type) values ($1, 'order', $1, 'order.created', 'system')`,
      [orderId],
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("anonymous users cannot access private data", () => {
    it("cannot select raw profiles, orders, payments, or locations", async () => {
      await asAnon(db, async () => {
        await expect(db.query(`select * from public.profiles`)).resolves.toMatchObject({ rows: [] });
        await expect(db.query(`select * from public.orders`)).resolves.toMatchObject({ rows: [] });
        await expect(db.query(`select * from public.payments`)).resolves.toMatchObject({ rows: [] });
        await expect(db.query(`select * from public.locations`)).resolves.toMatchObject({ rows: [] });
      });
    });

    it("can still read intentionally-public data", async () => {
      await asAnon(db, async () => {
        const profiles = await db.query(`select * from public.profiles_public`);
        expect(profiles.rows.length).toBeGreaterThan(0);
        const products = await db.query(`select * from public.products where status = 'active'`);
        expect(products.rows.length).toBe(2);
      });
    });
  });

  describe("a user cannot modify another user's profile", () => {
    it("Bob's UPDATE to Alice's profile matches 0 rows", async () => {
      const r = await asUser(db, bob, () => db.query(`update public.profiles set full_name = 'HACKED' where id = $1`, [alice]));
      expect(r.affectedRows).toBe(0);
      const check = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [alice]);
      expect(check.rows[0].full_name).toBe("Alice Buyer");
    });

    it("Alice can update her own profile (sanity check)", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`update public.profiles set full_name = 'Alice Updated' where id = $1`, [alice]),
      );
      expect(r.affectedRows).toBe(1);
    });

    it("Alice cannot self-promote to admin — role is not a grantable column", async () => {
      await asUser(db, alice, async () => {
        await expect(db.query(`update public.profiles set role = 'admin' where id = $1`, [alice])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });
  });

  describe("a buyer cannot modify another user's order (or their own, directly)", () => {
    it("Alice (the buyer) cannot UPDATE her own order — no write policy exists", async () => {
      const r = await asUser(db, alice, () => db.query(`update public.orders set status = 'cancelled' where id = $1`, [orderId]));
      expect(r.affectedRows).toBe(0);
    });

    it("Carol (unrelated) cannot UPDATE someone else's order", async () => {
      const r = await asUser(db, carol, () => db.query(`update public.orders set status = 'cancelled' where id = $1`, [orderId]));
      expect(r.affectedRows).toBe(0);
    });
  });

  describe("a seller cannot modify another seller's listing", () => {
    it("Carol cannot UPDATE Bob's product", async () => {
      const bobProduct = await db.query<{ id: string }>(`select id from public.products where title = 'Bob Toy'`);
      const r = await asUser(db, carol, () =>
        db.query(`update public.products set price_cents = 1 where id = $1`, [bobProduct.rows[0].id]),
      );
      expect(r.affectedRows).toBe(0);
    });

    it("Bob can update his own product (sanity check)", async () => {
      const bobProduct = await db.query<{ id: string }>(`select id from public.products where title = 'Bob Toy'`);
      const r = await asUser(db, bob, () =>
        db.query(`update public.products set price_cents = 9999 where id = $1`, [bobProduct.rows[0].id]),
      );
      expect(r.affectedRows).toBe(1);
    });
  });

  describe("a seller cannot manipulate commission amounts", () => {
    it("cannot UPDATE the commissions row on their own order", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`update public.commissions set commission_amount_cents = 1 where id = $1`, [commissionId]),
      );
      expect(r.affectedRows).toBe(0);
      const check = await db.query<{ commission_amount_cents: number }>(
        `select commission_amount_cents from public.commissions where id = $1`,
        [commissionId],
      );
      expect(check.rows[0].commission_amount_cents).toBe(1200);
    });

    it("cannot INSERT a fabricated commissions row", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(
            `insert into public.commissions (order_id, seller_type, rate_bps, base_amount_cents, commission_amount_cents) values ($1, 'parent', 1, 10000, 1)`,
            [orderId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  describe("users cannot directly modify payment or payout records", () => {
    it("buyer cannot mark their own payment as paid", async () => {
      const r = await asUser(db, alice, () => db.query(`update public.payments set status = 'paid' where id = $1`, [paymentId]));
      expect(r.affectedRows).toBe(0);
      const check = await db.query<{ status: string }>(`select status from public.payments where id = $1`, [paymentId]);
      expect(check.rows[0].status).toBe("pending");
    });

    it("seller cannot INSERT a fabricated payout for themselves", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(
            `insert into public.payouts (recipient_type, recipient_profile_id, amount_cents, status, period_start, period_end)
             values ('parent', $1, 999999999, 'paid', now(), now())`,
            [bob],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  describe("users cannot forge transaction events", () => {
    it("cannot INSERT a transaction_event directly", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(
            `insert into public.transaction_events (order_id, entity_type, entity_id, event_type, actor_type) values ($1, 'order', $1, 'payment.paid', 'system')`,
            [orderId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("order participants can read the order's events; unrelated users cannot", async () => {
      const asBob = await asUser(db, bob, () => db.query(`select * from public.transaction_events where order_id = $1`, [orderId]));
      expect(asBob.rows.length).toBe(1);
      const asCarol = await asUser(db, carol, () => db.query(`select * from public.transaction_events where order_id = $1`, [orderId]));
      expect(asCarol.rows.length).toBe(0);
    });
  });

  describe("cash collection confirmation cannot be arbitrarily forged", () => {
    it("seller cannot self-confirm collection directly", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`update public.collection_confirmations set confirmed_at = now(), confirmed_by = $1 where id = $2`, [
          bob,
          collectionConfirmationId,
        ]),
      );
      expect(r.affectedRows).toBe(0);
      const check = await db.query<{ confirmed_at: string | null }>(
        `select confirmed_at from public.collection_confirmations where id = $1`,
        [collectionConfirmationId],
      );
      expect(check.rows[0].confirmed_at).toBeNull();
    });

    it("an unrelated user cannot even read the collection code", async () => {
      const r = await asUser(db, carol, () => db.query(`select * from public.collection_confirmations where order_id = $1`, [orderId]));
      expect(r.rows.length).toBe(0);
    });
  });

  describe("exact seller coordinates are never exposed through normal client queries", () => {
    it("raw locations table is unreadable by anon", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select * from public.locations`);
        expect(r.rows.length).toBe(0);
      });
    });

    it("product_locations_public exposes only suburb/city/province", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select * from public.product_locations_public limit 1`);
        const cols = Object.keys(r.rows[0] ?? {});
        expect(cols).not.toEqual(expect.arrayContaining(["latitude", "longitude", "formatted_address"]));
        expect(cols.length).toBeGreaterThan(0);
      });
    });
  });

  describe("nearby search only exposes the intended approximate location/distance", () => {
    it("search_nearby_products() returns no lat/lng/address columns, only a rounded distance", async () => {
      await asAnon(db, async () => {
        const r = await db.query<Record<string, unknown>>(`select * from public.search_nearby_products($1, $2, $3, null)`, [
          -33.9, 18.4, 50,
        ]);
        expect(r.rows.length).toBeGreaterThan(0);
        const cols = Object.keys(r.rows[0]);
        expect(cols).not.toEqual(expect.arrayContaining(["latitude", "longitude", "address", "formatted_address"]));
        expect(cols).toContain("distance_km");
      });
    });
  });

  describe("service-role operations remain server-side only", () => {
    it("authenticated cannot mark a payment paid, but service_role can", async () => {
      const asBuyer = await asUser(db, bob, () => db.query(`update public.payments set status = 'paid' where id = $1`, [paymentId]));
      expect(asBuyer.affectedRows).toBe(0);

      const asService = await asServiceRole(db, () => db.query(`update public.payments set status = 'paid' where id = $1`, [paymentId]));
      expect(asService.affectedRows).toBe(1);

      const check = await db.query<{ status: string }>(`select status from public.payments where id = $1`, [paymentId]);
      expect(check.rows[0].status).toBe("paid");
    });

    it("row_security=off does not leak another user's row — Postgres refuses the query instead", async () => {
      await asUser(db, bob, async () => {
        await db.query(`set row_security = off`);
        try {
          await expect(db.query(`select * from public.profiles where id = $1`, [alice])).rejects.toThrow(
            /row-level security/i,
          );
        } finally {
          await db.query(`set row_security = on`);
        }
      });
    });
  });
});
