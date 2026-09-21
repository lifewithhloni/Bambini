import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 4A: create_order() — exercised against the real migration SQL
 * and real Postgres, the same method as every other tests/db/*.test.ts
 * file. create_order() is SECURITY DEFINER (see the migration's own
 * comment for why that's necessary here, unlike search_products()) —
 * every test below is proving what the function's *body* enforces from
 * auth.uid() and the product row, not bypassing anything.
 */
describe("create_order()", () => {
  let db: PGlite;
  let alice: string; // seller
  let bob: string; // buyer
  let carol: string; // unrelated user
  let categoryId: string;

  async function makeProduct(
    seller: string,
    title: string,
    overrides: {
      status?: "draft" | "published" | "archived";
      price_cents?: number;
      collection_available?: boolean;
      delivery_available?: boolean;
    } = {},
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

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    alice = await makeUser(db, "Orders Alice");
    bob = await makeUser(db, "Orders Bob");
    carol = await makeUser(db, "Orders Carol");

    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("auth", () => {
    it("1. anonymous cannot create an order", async () => {
      const productId = await makeProduct(alice, "Anon Test Stroller");
      await asAnon(db, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'collection')`, [productId]),
        ).rejects.toThrow();
      });
    });

    it("2. an authenticated user can create an eligible order", async () => {
      const productId = await makeProduct(alice, "Eligible Stroller");
      const r = await asUser(db, bob, () =>
        db.query<{ order_id: string; order_reference: string }>(`select * from public.create_order($1, 'collection')`, [
          productId,
        ]),
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].order_id).toBeTruthy();
      expect(r.rows[0].order_reference).toMatch(/^BMB-[0-9A-F]{6}$/);
    });
  });

  describe("product eligibility", () => {
    it("3. cannot buy a nonexistent product", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'collection')`, ["00000000-0000-4000-8000-000000000000"]),
        ).rejects.toThrow(/not available/i);
      });
    });

    it("4. cannot buy an unpublished (draft) product", async () => {
      const productId = await makeProduct(alice, "Draft Stroller", { status: "draft" });
      await asUser(db, bob, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection')`, [productId])).rejects.toThrow(
          /not available/i,
        );
      });
    });

    it("5. cannot buy an archived product", async () => {
      const productId = await makeProduct(alice, "Archived Stroller", { status: "archived" });
      await asUser(db, bob, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection')`, [productId])).rejects.toThrow(
          /not available/i,
        );
      });
    });

    it("6. cannot buy your own product", async () => {
      const productId = await makeProduct(alice, "Alice Own Stroller");
      await asUser(db, alice, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection')`, [productId])).rejects.toThrow(
          /own listing/i,
        );
      });
    });

    it("7. cannot buy a product that's already sold (unavailable)", async () => {
      const productId = await makeProduct(alice, "Already Sold Stroller");
      await asUser(db, bob, () => db.query(`select * from public.create_order($1, 'collection')`, [productId]));
      await asUser(db, carol, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection')`, [productId])).rejects.toThrow(
          /not available/i,
        );
      });
    });
  });

  describe("price security", () => {
    it("8. create_order() takes no price parameter at all — the client cannot override product price", async () => {
      await db.query("reset role");
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      const argNames = r.rows[0].proargnames;
      for (const forbidden of ["price", "price_cents", "unit_price_cents"]) {
        expect(argNames).not.toContain(forbidden);
      }
    });

    it("9. subtotal_cents is always the product's own DB price, never client-influenced", async () => {
      const productId = await makeProduct(alice, "Price Check Stroller", { price_cents: 73400 });
      const r = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const order = await db.query<{ subtotal_cents: string }>(`select subtotal_cents from public.orders where id = $1`, [
        r.rows[0].order_id,
      ]);
      expect(Number(order.rows[0].subtotal_cents)).toBe(73400);
    });

    it("10. total_cents is derived server-side (subtotal + 0 delivery fee for this phase), not client-supplied", async () => {
      const productId = await makeProduct(alice, "Total Check Stroller", { price_cents: 12000 });
      const r = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const order = await db.query<{ total_cents: string; delivery_fee_cents: string }>(
        `select total_cents, delivery_fee_cents from public.orders where id = $1`,
        [r.rows[0].order_id],
      );
      expect(Number(order.rows[0].total_cents)).toBe(12000);
      expect(Number(order.rows[0].delivery_fee_cents)).toBe(0);
    });

    it("11. create_order() takes no commission_rate parameter — the client cannot override it", async () => {
      await db.query("reset role");
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      expect(r.rows[0].proargnames).not.toContain("commission_rate");
      expect(r.rows[0].proargnames).not.toContain("commission_rate_bps");
    });

    it("12. commission_amount_cents is always computed server-side from the current commission_rates row", async () => {
      const productId = await makeProduct(alice, "Commission Check Stroller", { price_cents: 100000 });
      const r = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const order = await db.query<{ commission_amount_cents: string; commission_rate_bps: number }>(
        `select commission_amount_cents, commission_rate_bps from public.orders where id = $1`,
        [r.rows[0].order_id],
      );
      expect(order.rows[0].commission_rate_bps).toBe(1200); // parent seller, seeded rate
      expect(Number(order.rows[0].commission_amount_cents)).toBe(12000); // 12% of R1000
    });

    it("13. create_order() takes no seller_id/seller_profile_id parameter — seller is always derived from the product", async () => {
      await db.query("reset role");
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      const argNames = r.rows[0].proargnames;
      for (const forbidden of ["seller_id", "seller_profile_id", "business_id"]) {
        expect(argNames).not.toContain(forbidden);
      }
    });

    it("14. create_order() takes no buyer_id parameter — buyer is always auth.uid()", async () => {
      await db.query("reset role");
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      expect(r.rows[0].proargnames).not.toContain("buyer_id");

      const productId = await makeProduct(alice, "Buyer Identity Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const order = await db.query<{ buyer_id: string }>(`select buyer_id from public.orders where id = $1`, [
        created.rows[0].order_id,
      ]);
      expect(order.rows[0].buyer_id).toBe(bob);
    });
  });

  describe("authorization / access control", () => {
    it("15. buyer can see their own order", async () => {
      const productId = await makeProduct(alice, "Visibility Stroller A");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, bob, () => db.query(`select id from public.orders where id = $1`, [created.rows[0].order_id]));
      expect(r.rows).toHaveLength(1);
    });

    it("16. buyer cannot see another buyer's order", async () => {
      const productId = await makeProduct(alice, "Visibility Stroller B");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, carol, () => db.query(`select id from public.orders where id = $1`, [created.rows[0].order_id]));
      expect(r.rows).toHaveLength(0);
    });

    it("17. seller can see an order for their own listing", async () => {
      const productId = await makeProduct(alice, "Visibility Stroller C");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, alice, () => db.query(`select id from public.orders where id = $1`, [created.rows[0].order_id]));
      expect(r.rows).toHaveLength(1);
    });

    it("18. an unrelated seller cannot see someone else's order", async () => {
      const productId = await makeProduct(alice, "Visibility Stroller D");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, carol, () => db.query(`select id from public.orders where id = $1`, [created.rows[0].order_id]));
      expect(r.rows).toHaveLength(0);
    });

    it("19. a user cannot modify another user's order (no write policy exists for anyone but service-role)", async () => {
      const productId = await makeProduct(alice, "Visibility Stroller E");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, bob, () =>
        db.query(`update public.orders set status = 'completed' where id = $1`, [created.rows[0].order_id]),
      );
      expect(r.affectedRows).toBe(0);
    });
  });

  describe("status security", () => {
    it("20. a normal client cannot arbitrarily set payment status", async () => {
      const productId = await makeProduct(alice, "Payment Status Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, bob, () =>
        db.query(`update public.payments set status = 'paid' where order_id = $1`, [created.rows[0].order_id]),
      );
      expect(r.affectedRows).toBe(0);
    });

    it("21. a normal client cannot arbitrarily set order status", async () => {
      const productId = await makeProduct(alice, "Order Status Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, bob, () =>
        db.query(`update public.orders set status = 'confirmed' where id = $1`, [created.rows[0].order_id]),
      );
      expect(r.affectedRows).toBe(0);
    });

    it("22. a normal client cannot modify financial fields (total_cents, commission_amount_cents)", async () => {
      const productId = await makeProduct(alice, "Financial Fields Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, bob, () =>
        db.query(`update public.orders set total_cents = 1, commission_amount_cents = 1 where id = $1`, [
          created.rows[0].order_id,
        ]),
      );
      expect(r.affectedRows).toBe(0);
    });

    it("23. transaction events cannot be modified by normal clients — no UPDATE policy exists, so this is a silent 0-row match, not a thrown error (the trigger is the deeper, RLS-independent guard — see test 32)", async () => {
      const productId = await makeProduct(alice, "Event Immutability Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      const r = await asUser(db, bob, () =>
        db.query(`update public.transaction_events set event_type = 'hacked' where order_id = $1`, [created.rows[0].order_id]),
      );
      expect(r.affectedRows).toBe(0);
      await db.query("reset role");
      const check = await db.query<{ event_type: string }>(`select event_type from public.transaction_events where order_id = $1`, [
        created.rows[0].order_id,
      ]);
      expect(check.rows[0].event_type).toBe("order.created");
    });
  });

  describe("race conditions", () => {
    it("24. two simultaneous buyers cannot both successfully purchase the same single-quantity listing", async () => {
      const productId = await makeProduct(alice, "Race Condition Stroller");

      const [bobResult, carolResult] = await Promise.allSettled([
        asUser(db, bob, () => db.query(`select * from public.create_order($1, 'collection')`, [productId])),
        asUser(db, carol, () => db.query(`select * from public.create_order($1, 'collection')`, [productId])),
      ]);

      const outcomes = [bobResult, carolResult];
      const succeeded = outcomes.filter((o) => o.status === "fulfilled");
      const failed = outcomes.filter((o) => o.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      await db.query("reset role");
      const orders = await db.query(`select o.id from public.orders o join public.order_items oi on oi.order_id = o.id where oi.product_id = $1`, [
        productId,
      ]);
      expect(orders.rows).toHaveLength(1);
    });
  });

  describe("duplication", () => {
    it("25. a retried/double-submitted request cannot create a duplicate successful order for the same listing", async () => {
      const productId = await makeProduct(alice, "Double Submit Stroller");

      const first = await asUser(db, bob, () => db.query(`select * from public.create_order($1, 'collection')`, [productId]));
      expect(first.rows).toHaveLength(1);

      await asUser(db, bob, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection')`, [productId])).rejects.toThrow(
          /not available/i,
        );
      });

      await db.query("reset role");
      const orders = await db.query(`select o.id from public.orders o join public.order_items oi on oi.order_id = o.id where oi.product_id = $1`, [
        productId,
      ]);
      expect(orders.rows).toHaveLength(1);
    });
  });

  describe("commission", () => {
    it("26. a parent seller's order snapshots the seeded 12% (1200 bps) rate", async () => {
      const productId = await makeProduct(alice, "Parent Commission Stroller", { price_cents: 50000 });
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const commission = await db.query<{ rate_bps: number }>(`select rate_bps from public.commissions where order_id = $1`, [
        created.rows[0].order_id,
      ]);
      expect(commission.rows[0].rate_bps).toBe(1200);
    });

    it("27. commission_rates has a seeded business-seller rate (1500 bps) the same lookup would use for a business order", async () => {
      await db.query("reset role");
      const r = await db.query<{ rate_bps: number }>(
        `select rate_bps from public.commission_rates where seller_type = 'business' and effective_from <= now() order by effective_from desc limit 1`,
      );
      expect(r.rows[0].rate_bps).toBe(1500);
    });

    it("28. commission amount is correctly calculated server-side (round-half-up, integer cents)", async () => {
      // R333.33 * 12% = 39.9996 -> rounds to 40 cents... i.e. 40.00 -> R0.40? use a value that exercises rounding precisely.
      const productId = await makeProduct(alice, "Rounding Stroller", { price_cents: 3333 }); // R33.33
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const commission = await db.query<{ commission_amount_cents: string }>(
        `select commission_amount_cents from public.commissions where order_id = $1`,
        [created.rows[0].order_id],
      );
      // 3333 * 1200 / 10000 = 399.96 -> rounds to 400
      expect(Number(commission.rows[0].commission_amount_cents)).toBe(400);
    });
  });

  describe("fulfilment", () => {
    it("29. collection is only allowed when the listing supports collection", async () => {
      const productId = await makeProduct(alice, "Delivery Only Stroller", { collection_available: false, delivery_available: true });
      await asUser(db, bob, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection')`, [productId])).rejects.toThrow(
          /collection is not available/i,
        );
      });
    });

    it("30. delivery is only allowed when the listing supports delivery", async () => {
      const productId = await makeProduct(alice, "Collection Only Stroller", { collection_available: true, delivery_available: false });
      await asUser(db, bob, async () => {
        await expect(db.query(`select * from public.create_order($1, 'delivery')`, [productId])).rejects.toThrow(
          /delivery is not available/i,
        );
      });
    });

    it("delivery requires the buyer to have a saved location first", async () => {
      const productId = await makeProduct(alice, "Delivery Needs Location Stroller");
      await asUser(db, carol, async () => {
        await expect(db.query(`select * from public.create_order($1, 'delivery')`, [productId])).rejects.toThrow(
          /delivery location/i,
        );
      });
    });

    it("delivery succeeds and snapshots the buyer's saved location once one exists", async () => {
      const loc = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, -33.9, 18.4, 'Gardens', 'Cape Town') returning id`,
        [bob],
      );
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [loc.rows[0].id, bob]);

      const productId = await makeProduct(alice, "Delivery With Location Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery')`, [productId]),
      );
      await db.query("reset role");
      const order = await db.query<{ delivery_location_id: string }>(
        `select delivery_location_id from public.orders where id = $1`,
        [created.rows[0].order_id],
      );
      expect(order.rows[0].delivery_location_id).toBe(loc.rows[0].id);
    });
  });

  describe("events", () => {
    it("31. a successful order creates exactly one ORDER_CREATED (order.created) transaction event", async () => {
      const productId = await makeProduct(alice, "Event Creation Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      await db.query("reset role");
      const events = await db.query<{ event_type: string; actor_type: string }>(
        `select event_type, actor_type from public.transaction_events where order_id = $1`,
        [created.rows[0].order_id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].event_type).toBe("order.created");
      expect(events.rows[0].actor_type).toBe("buyer");
    });

    it("32. transaction events are append-only — confirmed at the trigger level, not just RLS", async () => {
      await db.query("reset role");
      const productId = await makeProduct(alice, "Trigger Immutability Stroller");
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]),
      );
      // As service_role, which bypasses RLS entirely — the append-only
      // guarantee has to come from the trigger, not RLS, for this to fail.
      await db.query("set role service_role");
      await expect(
        db.query(`update public.transaction_events set event_type = 'hacked' where order_id = $1`, [created.rows[0].order_id]),
      ).rejects.toThrow(/append-only/i);
      await db.query("reset role");
    });
  });

  describe("function security posture", () => {
    it("is SECURITY DEFINER, with search_path pinned to public, EXECUTE restricted to authenticated only", async () => {
      await db.query("reset role");
      const r = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where proname = 'create_order'`,
      );
      expect(r.rows[0].prosecdef).toBe(true);
      expect(r.rows[0].proconfig).toContain("search_path=public");

      const grants = await db.query<{ grantee: string }>(`
        select grantee from information_schema.routine_privileges
        where routine_name = 'create_order' and privilege_type = 'EXECUTE'
      `);
      const grantees = grants.rows.map((row) => row.grantee).sort();
      expect(grantees).not.toContain("PUBLIC");
      expect(grantees).not.toContain("anon");
      expect(grantees).toEqual(expect.arrayContaining(["authenticated"]));
    });
  });
});
