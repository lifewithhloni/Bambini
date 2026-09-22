import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

/**
 * Phase 7C: server-authoritative delivery markup — exercised against the
 * real migration SQL and real Postgres, the same method as every other
 * tests/db/*.test.ts file. Quotes are inserted directly as fixtures
 * (makeDeliveryQuote(), extended in harness.ts for this phase) rather
 * than through src/server/delivery/quoteService.ts — that TS module's
 * own markup application is covered by calculateDeliveryMarkup.test.ts;
 * what's under test here is what create_order()/RLS/the settings
 * function enforce once a quote row with a markup breakdown exists.
 */
describe("delivery markup (Phase 7C)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Markup Settings Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.query("reset role");
    // Always restore the baseline setting a few tests deliberately change.
    await asUser(db, admin, () => db.query(`select public.update_delivery_markup_setting(0)`));
  });

  async function setMarkup(bps: number) {
    return asUser(db, admin, () => db.query(`select public.update_delivery_markup_setting($1)`, [bps]));
  }

  async function makeLocation(ownerId: string, lat = -33.9, lng = 18.4) {
    const r = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, $2, $3, 'Gardens', 'Cape Town') returning id`,
      [ownerId, lat, lng],
    );
    return r.rows[0].id;
  }

  async function makeProduct(sellerProfileId: string, title: string, pickupLocationId: string) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available, pickup_location_id)
       values ('parent', $1, $2, $3, 'good', 50000, 'published', true, true, $4)
       returning id`,
      [sellerProfileId, categoryId, title, pickupLocationId],
    );
    return r.rows[0].id;
  }

  /** Seller + buyer + locations + published product + a fresh, not-yet-used quote — stops BEFORE order creation, so it's safe to reuse for tests that need an unconsumed quote/still-published product (e.g. ownership/expiry checks) rather than one already 'sold' by makeMarkupOrder(). */
  async function makeMarkupQuoteFixture(providerCostCents: number, markupPercentageBps: number) {
    const seller = await makeUser(db, `Markup Seller ${Math.random()}`);
    const buyer = await makeUser(db, `Markup Buyer ${Math.random()}`);
    const sellerLocationId = await makeLocation(seller, -33.95, 18.45);
    const buyerLocationId = await makeLocation(buyer, -33.9, 18.4);
    await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId, buyer]);
    const productId = await makeProduct(seller, "Markup Fixture Toy", sellerLocationId);
    const quoteId = await makeDeliveryQuote(db, {
      buyerId: buyer,
      productId,
      pickupLocationId: sellerLocationId,
      dropoffLocationId: buyerLocationId,
      providerCostCents,
      markupPercentageBps,
    });
    return { seller, buyer, sellerLocationId, buyerLocationId, productId, quoteId };
  }

  /** Full setup through order creation, given an explicit provider cost + markup rate to snapshot onto the quote — exactly what quoteService.ts would have persisted after reading that rate from delivery_markup_settings at fetch time. */
  async function makeMarkupOrder(providerCostCents: number, markupPercentageBps: number) {
    const { seller, buyer, productId, quoteId } = await makeMarkupQuoteFixture(providerCostCents, markupPercentageBps);
    const r = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
    );
    await db.query("reset role");
    const order = await db.query<{
      subtotal_cents: string;
      delivery_fee_cents: string;
      provider_delivery_cost_cents: string;
      delivery_markup_percentage_bps: number;
      delivery_markup_amount_cents: string;
      total_cents: string;
      commission_amount_cents: string;
    }>(
      `select subtotal_cents, delivery_fee_cents, provider_delivery_cost_cents, delivery_markup_percentage_bps, delivery_markup_amount_cents, total_cents, commission_amount_cents
       from public.orders where id = $1`,
      [r.rows[0].order_id],
    );
    return { orderId: r.rows[0].order_id, buyer, seller, productId, quoteId, order: order.rows[0] };
  }

  describe("markup calculation across rates (1-4)", () => {
    it("1. 0% markup: buyer delivery fee equals provider cost exactly", async () => {
      const { order } = await makeMarkupOrder(5000, 0);
      expect(Number(order.provider_delivery_cost_cents)).toBe(5000);
      expect(order.delivery_markup_percentage_bps).toBe(0);
      expect(Number(order.delivery_markup_amount_cents)).toBe(0);
      expect(Number(order.delivery_fee_cents)).toBe(5000);
    });

    it("2. 5% markup", async () => {
      const { order } = await makeMarkupOrder(5000, 500);
      expect(Number(order.delivery_markup_amount_cents)).toBe(250);
      expect(Number(order.delivery_fee_cents)).toBe(5250);
    });

    it("3. 10% markup", async () => {
      const { order } = await makeMarkupOrder(5000, 1000);
      expect(Number(order.delivery_markup_amount_cents)).toBe(500);
      expect(Number(order.delivery_fee_cents)).toBe(5500);
    });

    it("4. 20% markup — matches the phase brief's own example: R50.00 provider cost -> R10.00 markup -> R60.00 buyer fee", async () => {
      const { order } = await makeMarkupOrder(5000, 2000);
      expect(Number(order.provider_delivery_cost_cents)).toBe(5000);
      expect(Number(order.delivery_markup_amount_cents)).toBe(1000);
      expect(Number(order.delivery_fee_cents)).toBe(6000);
    });
  });

  it("5. a decimal-cents provider cost (R47.33) rounds identically to calculateDeliveryMarkup()", async () => {
    const { order } = await makeMarkupOrder(4733, 1500);
    // 4733 * 1500 / 10000 = 709.95 -> rounds to 710
    expect(Number(order.delivery_markup_amount_cents)).toBe(710);
    expect(Number(order.delivery_fee_cents)).toBe(5443);
  });

  it("6. R0 collection: provider cost, markup, and buyer delivery fee are all R0, regardless of the configured markup rate", async () => {
    await setMarkup(2000);
    const seller = await makeUser(db, "Collection Markup Seller");
    const buyer = await makeUser(db, "Collection Markup Buyer");
    const sellerLocationId = await makeLocation(seller);
    const productId = await makeProduct(seller, "Collection Markup Toy", sellerLocationId);
    const r = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]));
    await db.query("reset role");
    const order = await db.query<{ delivery_fee_cents: string; provider_delivery_cost_cents: string; delivery_markup_amount_cents: string }>(
      `select delivery_fee_cents, provider_delivery_cost_cents, delivery_markup_amount_cents from public.orders where id = $1`,
      [r.rows[0].order_id],
    );
    expect(Number(order.rows[0].delivery_fee_cents)).toBe(0);
    expect(Number(order.rows[0].provider_delivery_cost_cents)).toBe(0);
    expect(Number(order.rows[0].delivery_markup_amount_cents)).toBe(0);
  });

  describe("client cannot manipulate pricing (7-9, 22)", () => {
    it("7. create_order() takes no delivery_fee_cents parameter at all", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      expect(r.rows[0].proargnames).not.toContain("delivery_fee_cents");
      expect(r.rows[0].proargnames).not.toContain("p_delivery_fee_cents");
    });

    it("8. create_order() takes no provider_cost parameter at all", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      expect(r.rows[0].proargnames).not.toContain("provider_delivery_cost_cents");
      expect(r.rows[0].proargnames).not.toContain("p_provider_delivery_cost_cents");
    });

    it("9. create_order() takes no markup_percentage parameter at all", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      expect(r.rows[0].proargnames).not.toContain("delivery_markup_percentage_bps");
      expect(r.rows[0].proargnames).not.toContain("p_delivery_markup_percentage_bps");
      // The only delivery-related parameter is the quote reference itself.
      expect(r.rows[0].proargnames).toEqual(["p_product_id", "p_fulfilment_type", "p_payment_method", "p_delivery_quote_id", "order_id", "order_reference"]);
    });

    it("22. a client attempting to tamper with an already-persisted quote's price/provider-cost/markup columns is rejected by RLS, never reaching create_order() with a manipulated value", async () => {
      const { buyer, quoteId } = await makeMarkupOrder(5000, 1000);
      const tampered = await asUser(db, buyer, () =>
        db.query(`update public.delivery_quotes set price_cents = 1, provider_cost_cents = 1, markup_percentage_bps = 0 where id = $1`, [quoteId]),
      );
      expect(tampered.affectedRows).toBe(0);
    });
  });

  it("10. an existing order keeps its original markup rate after the admin changes the global setting", async () => {
    await setMarkup(1000); // 10%
    const { orderId, order: orderAt10 } = await makeMarkupOrder(5000, 1000);
    expect(orderAt10.delivery_markup_percentage_bps).toBe(1000);
    expect(Number(orderAt10.delivery_fee_cents)).toBe(5500);

    await setMarkup(2000); // admin changes to 20% AFTER order A was created

    const orderAAfterChange = await db.query<{ delivery_markup_percentage_bps: number; delivery_fee_cents: string }>(
      `select delivery_markup_percentage_bps, delivery_fee_cents from public.orders where id = $1`,
      [orderId],
    );
    expect(orderAAfterChange.rows[0].delivery_markup_percentage_bps).toBe(1000);
    expect(Number(orderAAfterChange.rows[0].delivery_fee_cents)).toBe(5500);

    // A new order created after the change uses the new rate.
    const { order: orderAt20 } = await makeMarkupOrder(5000, 2000);
    expect(orderAt20.delivery_markup_percentage_bps).toBe(2000);
    expect(Number(orderAt20.delivery_fee_cents)).toBe(6000);
  });

  describe("admin markup settings (11-13)", () => {
    it("11. an admin can update the markup setting, and it becomes the new current value", async () => {
      await setMarkup(1500);
      const current = await asUser(db, admin, () =>
        db.query<{ markup_percentage_bps: number }>(`select markup_percentage_bps from public.delivery_markup_settings order by effective_from desc limit 1`),
      );
      expect(current.rows[0].markup_percentage_bps).toBe(1500);
    });

    it("11a. updating the setting inserts a NEW row (append-only) rather than mutating the existing one", async () => {
      const before = await asUser(db, admin, () => db.query(`select id from public.delivery_markup_settings`));
      await setMarkup(1500);
      const after = await asUser(db, admin, () => db.query(`select id from public.delivery_markup_settings`));
      expect(after.rows.length).toBe(before.rows.length + 1);
    });

    it("11b. updating the setting records changed_by as the acting admin", async () => {
      await setMarkup(750);
      const current = await asUser(db, admin, () =>
        db.query<{ changed_by: string }>(`select changed_by from public.delivery_markup_settings order by effective_from desc limit 1`),
      );
      expect(current.rows[0].changed_by).toBe(admin);
    });

    it("12. a non-admin authenticated user cannot update the markup setting", async () => {
      const buyer = await makeUser(db, "Non Admin Markup Attempt");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select public.update_delivery_markup_setting(5000)`)).rejects.toThrow(/admin authorization required/i);
      });
    });

    it("12a. a non-admin authenticated user cannot read delivery_markup_settings directly", async () => {
      const buyer = await makeUser(db, "Non Admin Markup Read Attempt");
      const seen = await asUser(db, buyer, () => db.query(`select * from public.delivery_markup_settings`));
      expect(seen.rows).toHaveLength(0);
    });

    it("13. a negative markup percentage is rejected", async () => {
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.update_delivery_markup_setting(-1)`)).rejects.toThrow(/between 0/i);
      });
    });

    it("13a. a markup percentage above 100% (10000 bps) is rejected", async () => {
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.update_delivery_markup_setting(10001)`)).rejects.toThrow(/between 0/i);
      });
    });

    it("13b. an invalid value never becomes the current setting", async () => {
      await setMarkup(600);
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.update_delivery_markup_setting(99999)`)).rejects.toThrow();
      });
      const current = await asUser(db, admin, () =>
        db.query<{ markup_percentage_bps: number }>(`select markup_percentage_bps from public.delivery_markup_settings order by effective_from desc limit 1`),
      );
      expect(current.rows[0].markup_percentage_bps).toBe(600);
    });
  });

  it("14. the provider quote's own cost is preserved exactly, never overwritten by the marked-up amount", async () => {
    const { quoteId } = await makeMarkupOrder(5000, 2000);
    await db.query("reset role");
    const quote = await db.query<{ provider_cost_cents: string; price_cents: string }>(
      `select provider_cost_cents, price_cents from public.delivery_quotes where id = $1`,
      [quoteId],
    );
    expect(Number(quote.rows[0].provider_cost_cents)).toBe(5000);
    expect(Number(quote.rows[0].price_cents)).toBe(6000);
    expect(quote.rows[0].provider_cost_cents).not.toBe(quote.rows[0].price_cents);
  });

  it("15. the buyer-facing delivery fee is correctly calculated as provider cost + markup amount", async () => {
    const { order } = await makeMarkupOrder(4321, 1234);
    const expectedMarkup = Math.round((4321 * 1234) / 10000);
    expect(Number(order.delivery_markup_amount_cents)).toBe(expectedMarkup);
    expect(Number(order.delivery_fee_cents)).toBe(4321 + expectedMarkup);
  });

  it("16. the order total (what PayFast is asked to charge) is product subtotal + the marked-up buyer delivery fee, never the provider's raw cost", async () => {
    const { order } = await makeMarkupOrder(5000, 2000);
    expect(Number(order.total_cents)).toBe(Number(order.subtotal_cents) + 6000);
    // Never the unmarked-up provider cost.
    expect(Number(order.total_cents)).not.toBe(Number(order.subtotal_cents) + 5000);
  });

  it("17. commission (seller earnings) is computed from the product subtotal only, completely unaffected by the delivery markup", async () => {
    const { order } = await makeMarkupOrder(5000, 2000); // subtotal is always 50000 (makeProduct's fixed price)
    expect(Number(order.commission_amount_cents)).toBe(6000); // 12% of R500, unchanged by any delivery markup
  });

  it("18. an expired quote still cannot be used, even with markup fields populated", async () => {
    const seller = await makeUser(db, "Markup Expiry Seller");
    const buyer = await makeUser(db, "Markup Expiry Buyer");
    const sellerLocationId = await makeLocation(seller, -33.95, 18.45);
    const buyerLocationId = await makeLocation(buyer, -33.9, 18.4);
    await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId, buyer]);
    const productId = await makeProduct(seller, "Markup Expiry Toy", sellerLocationId);
    const quoteId = await makeDeliveryQuote(db, {
      buyerId: buyer,
      productId,
      pickupLocationId: sellerLocationId,
      dropoffLocationId: buyerLocationId,
      providerCostCents: 5000,
      markupPercentageBps: 1000,
      expiresInMinutes: -1,
    });
    await asUser(db, buyer, async () => {
      await expect(db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId])).rejects.toThrow(/expired/i);
    });
  });

  it("19. a quote belonging to another buyer still cannot be used, even with markup fields populated", async () => {
    const { productId, quoteId } = await makeMarkupQuoteFixture(5000, 1000);
    const stranger = await makeUser(db, "Markup Ownership Stranger");
    const strangerLocationId = await makeLocation(stranger, -33.8, 18.3);
    await db.query(`update public.profiles set location_id = $1 where id = $2`, [strangerLocationId, stranger]);
    await asUser(db, stranger, async () => {
      await expect(db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId])).rejects.toThrow(
        /delivery quote not found/i,
      );
    });
  });

  it("20. free collection never generates delivery margin: provider cost and markup amount are both exactly 0, never a rounding artifact", async () => {
    await setMarkup(1750); // an odd rate that would produce a nonzero rounded markup on anything but a true R0 base
    const seller = await makeUser(db, "No Margin Collection Seller");
    const buyer = await makeUser(db, "No Margin Collection Buyer");
    const sellerLocationId = await makeLocation(seller);
    const productId = await makeProduct(seller, "No Margin Collection Toy", sellerLocationId);
    const r = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]));
    await db.query("reset role");
    const order = await db.query<{ delivery_markup_amount_cents: string }>(`select delivery_markup_amount_cents from public.orders where id = $1`, [r.rows[0].order_id]);
    expect(Number(order.rows[0].delivery_markup_amount_cents)).toBe(0);
  });

  it("21. the delivery quote's provider_quote_ref (what booking actually uses) is present and independent of the buyer-facing price — booking never depends on price_cents", async () => {
    const { quoteId } = await makeMarkupOrder(5000, 2000);
    await db.query("reset role");
    const quote = await db.query<{ provider_quote_ref: string }>(`select provider_quote_ref from public.delivery_quotes where id = $1`, [quoteId]);
    expect(quote.rows[0].provider_quote_ref).toBeTruthy();
    // bookingService.ts (src/server/delivery/bookingService.ts) only ever
    // reads provider_quote_ref/pickup_location_id/dropoff_location_id off
    // this row to build BookDeliveryRequest — price_cents/provider_cost_cents/
    // markup_amount_cents are never part of that request shape at all (see
    // BookDeliveryRequest in src/server/delivery/types.ts), so there is no
    // code path through which the marked-up fee could reach the provider.
  });

  describe("orders/delivery_quotes internal consistency (defense in depth)", () => {
    it("a normal authenticated client cannot directly update orders.provider_delivery_cost_cents or delivery_markup_amount_cents", async () => {
      const { orderId, buyer } = await makeMarkupOrder(5000, 1000);
      const updated = await asUser(db, buyer, () =>
        db.query(`update public.orders set provider_delivery_cost_cents = 1, delivery_markup_amount_cents = 1 where id = $1`, [orderId]),
      );
      expect(updated.affectedRows).toBe(0);
    });

    it("the database rejects an orders row whose delivery_fee_cents doesn't equal provider_delivery_cost_cents + delivery_markup_amount_cents (CHECK constraint)", async () => {
      const buyer = await makeUser(db, "Check Constraint Buyer");
      const seller = await makeUser(db, "Check Constraint Seller");
      await expect(
        db.query(
          `insert into public.orders (buyer_id, seller_type, seller_profile_id, fulfilment_type, payment_method, subtotal_cents, delivery_fee_cents, provider_delivery_cost_cents, delivery_markup_amount_cents, total_cents, commission_rate_bps, commission_amount_cents)
           values ($1, 'parent', $2, 'collection', 'online', 10000, 500, 100, 100, 10500, 1200, 1200)`,
          [buyer, seller],
        ),
      ).rejects.toThrow(/orders_delivery_fee_matches_markup/i);
    });
  });
});
