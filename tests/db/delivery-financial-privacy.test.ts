import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

/**
 * Phase 7D: delivery financial visibility & security hardening —
 * exercised against the real migration SQL and real Postgres, the same
 * method as every other tests/db/*.test.ts file. Covers the new
 * column-level SELECT restriction on orders/delivery_quotes (Phase 7C's
 * own report flagged the gap this closes) and
 * list_delivery_financial_transactions(), the one sanctioned admin read
 * of the fields it closes off.
 */
describe("delivery financial privacy (Phase 7D)", () => {
  let db: PGlite;
  let categoryId: string;
  let admin: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    admin = await makeUser(db, "Financial Privacy Admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.query("reset role");
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

  /** Full setup through order creation, given an explicit provider cost + markup rate. */
  async function makeMarkupOrder(providerCostCents: number, markupPercentageBps: number) {
    const seller = await makeUser(db, `Privacy Seller ${Math.random()}`);
    const buyer = await makeUser(db, `Privacy Buyer ${Math.random()}`);
    const sellerLocationId = await makeLocation(seller, -33.95, 18.45);
    const buyerLocationId = await makeLocation(buyer, -33.9, 18.4);
    await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId, buyer]);
    const productId = await makeProduct(seller, "Privacy Fixture Toy", sellerLocationId);
    const quoteId = await makeDeliveryQuote(db, {
      buyerId: buyer,
      productId,
      pickupLocationId: sellerLocationId,
      dropoffLocationId: buyerLocationId,
      providerCostCents,
      markupPercentageBps,
    });
    const r = await asUser(db, buyer, () =>
      db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
    );
    await db.query("reset role");
    return { orderId: r.rows[0].order_id, buyer, seller, productId, quoteId };
  }

  describe("buyer cannot read delivery economics through normal order access (1-4)", () => {
    it("1. buyer cannot select provider_delivery_cost_cents on their own order", async () => {
      const { orderId, buyer } = await makeMarkupOrder(5000, 2000);
      await asUser(db, buyer, async () => {
        await expect(db.query(`select provider_delivery_cost_cents from public.orders where id = $1`, [orderId])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });

    it("2. buyer cannot select delivery_markup_percentage_bps on their own order", async () => {
      const { orderId, buyer } = await makeMarkupOrder(5000, 2000);
      await asUser(db, buyer, async () => {
        await expect(db.query(`select delivery_markup_percentage_bps from public.orders where id = $1`, [orderId])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });

    it("3. buyer cannot select delivery_markup_amount_cents on their own order", async () => {
      const { orderId, buyer } = await makeMarkupOrder(5000, 2000);
      await asUser(db, buyer, async () => {
        await expect(db.query(`select delivery_markup_amount_cents from public.orders where id = $1`, [orderId])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });

    it("4. buyer cannot derive Bambini's delivery margin — a select * on their own order is rejected outright, not silently missing columns", async () => {
      const { orderId, buyer } = await makeMarkupOrder(5000, 2000);
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.orders where id = $1`, [orderId])).rejects.toThrow(/permission denied/i);
      });
    });

    it("4a. the same restriction applies to delivery_quotes: provider_cost_cents, markup fields, and raw_response are all unreadable", async () => {
      const { buyer, quoteId } = await makeMarkupOrder(5000, 2000);
      await asUser(db, buyer, async () => {
        await expect(db.query(`select provider_cost_cents from public.delivery_quotes where id = $1`, [quoteId])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select markup_percentage_bps from public.delivery_quotes where id = $1`, [quoteId])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select markup_amount_cents from public.delivery_quotes where id = $1`, [quoteId])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select raw_response from public.delivery_quotes where id = $1`, [quoteId])).rejects.toThrow(/permission denied/i);
      });
    });
  });

  describe("seller cannot read delivery economics through normal order access (5-7)", () => {
    it("5. seller cannot select provider_delivery_cost_cents on an order for their own listing", async () => {
      const { orderId, seller } = await makeMarkupOrder(5000, 2000);
      await asUser(db, seller, async () => {
        await expect(db.query(`select provider_delivery_cost_cents from public.orders where id = $1`, [orderId])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });

    it("6. seller cannot select delivery_markup_percentage_bps or delivery_markup_amount_cents", async () => {
      const { orderId, seller } = await makeMarkupOrder(5000, 2000);
      await asUser(db, seller, async () => {
        await expect(db.query(`select delivery_markup_percentage_bps from public.orders where id = $1`, [orderId])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select delivery_markup_amount_cents from public.orders where id = $1`, [orderId])).rejects.toThrow(/permission denied/i);
      });
    });

    it("7. seller cannot derive Bambini's delivery margin — a select * on an order for their own listing is rejected outright", async () => {
      const { orderId, seller } = await makeMarkupOrder(5000, 2000);
      await asUser(db, seller, async () => {
        await expect(db.query(`select * from public.orders where id = $1`, [orderId])).rejects.toThrow(/permission denied/i);
      });
    });

    it("7a. the seller keeps every column they're actually meant to see — commission and the buyer-facing delivery fee remain readable", async () => {
      const { orderId, seller } = await makeMarkupOrder(5000, 2000);
      const row = await asUser(db, seller, () =>
        db.query<{ commission_amount_cents: string; delivery_fee_cents: string; total_cents: string }>(
          `select commission_amount_cents, delivery_fee_cents, total_cents from public.orders where id = $1`,
          [orderId],
        ),
      );
      expect(Number(row.rows[0].commission_amount_cents)).toBe(6000);
      expect(Number(row.rows[0].delivery_fee_cents)).toBe(6000); // 5000 + 20%
    });
  });

  describe("admin financial visibility (8-9)", () => {
    it("8. an admin can read delivery financial fields via list_delivery_financial_transactions()", async () => {
      const { orderId } = await makeMarkupOrder(5000, 2000);
      const rows = await asUser(db, admin, () =>
        db.query<{ order_id: string; provider_delivery_cost_cents: string; delivery_margin_cents: string }>(
          `select * from public.list_delivery_financial_transactions()`,
        ),
      );
      const row = rows.rows.find((r) => r.order_id === orderId);
      expect(row).toBeTruthy();
      expect(Number(row!.provider_delivery_cost_cents)).toBe(5000);
    });

    it("8a. a non-admin authenticated user cannot call list_delivery_financial_transactions()", async () => {
      const nonAdmin = await makeUser(db, "Non Admin Financial Attempt");
      await asUser(db, nonAdmin, async () => {
        await expect(db.query(`select * from public.list_delivery_financial_transactions()`)).rejects.toThrow(/admin authorization required/i);
      });
    });

    it("9. the admin table returns correct provider cost, markup, and margin values for a real order", async () => {
      const { orderId } = await makeMarkupOrder(4321, 1500); // 15%
      const rows = await asUser(db, admin, () => db.query<Record<string, string | number>>(`select * from public.list_delivery_financial_transactions()`));
      const row = rows.rows.find((r) => r.order_id === orderId)!;
      const expectedMarkup = Math.round((4321 * 1500) / 10000);
      expect(Number(row.provider_delivery_cost_cents)).toBe(4321);
      expect(Number(row.delivery_markup_amount_cents)).toBe(expectedMarkup);
      expect(Number(row.buyer_delivery_fee_cents)).toBe(4321 + expectedMarkup);
      expect(Number(row.delivery_margin_cents)).toBe(expectedMarkup); // margin = fee - cost = markup amount, when nothing else touches the fee
      expect(row.delivery_markup_percentage_bps).toBe(1500);
      expect(row.provider_slug).toBe("mock");
    });

    it("9a. the admin table can filter by fulfilment type, delivery status, and provider", async () => {
      await makeMarkupOrder(5000, 1000);
      const seller = await makeUser(db, "Filter Collection Seller");
      const buyer = await makeUser(db, "Filter Collection Buyer");
      const sellerLocationId = await makeLocation(seller);
      const productId = await makeProduct(seller, "Filter Collection Toy", sellerLocationId);
      await asUser(db, buyer, () => db.query(`select * from public.create_order($1, 'collection')`, [productId]));

      const deliveryOnly = await asUser(db, admin, () =>
        db.query<{ fulfilment_type: string }>(`select * from public.list_delivery_financial_transactions('delivery')`),
      );
      expect(deliveryOnly.rows.every((r) => r.fulfilment_type === "delivery")).toBe(true);

      const collectionOnly = await asUser(db, admin, () =>
        db.query<{ fulfilment_type: string }>(`select * from public.list_delivery_financial_transactions('collection')`),
      );
      expect(collectionOnly.rows.every((r) => r.fulfilment_type === "collection")).toBe(true);
      expect(collectionOnly.rows.length).toBeGreaterThan(0);
    });
  });

  it("10. the buyer-facing delivery fee remains correctly readable — orders.delivery_fee_cents is not part of the restricted set", async () => {
    const { orderId, buyer } = await makeMarkupOrder(5000, 2000);
    const row = await asUser(db, buyer, () => db.query<{ delivery_fee_cents: string; total_cents: string }>(`select delivery_fee_cents, total_cents from public.orders where id = $1`, [orderId]));
    expect(Number(row.rows[0].delivery_fee_cents)).toBe(6000);
  });

  it("11. historical pricing is unchanged after a global markup change, confirmed from the admin's own financial view", async () => {
    await setMarkup(1000); // 10%
    const { orderId: orderAId } = await makeMarkupOrder(5000, 1000);

    await setMarkup(2000); // admin changes to 20% afterwards

    const rows = await asUser(db, admin, () => db.query<Record<string, string | number>>(`select * from public.list_delivery_financial_transactions()`));
    const orderA = rows.rows.find((r) => r.order_id === orderAId)!;
    expect(orderA.delivery_markup_percentage_bps).toBe(1000);
    expect(Number(orderA.buyer_delivery_fee_cents)).toBe(5500);
    expect(Number(orderA.delivery_margin_cents)).toBe(500);
  });

  it("17. free collection shows R0 provider cost, R0 buyer fee, and R0 margin in the admin view — never a rounding artifact", async () => {
    await setMarkup(1750); // an odd rate that would produce a nonzero rounded markup on anything but a true R0 base
    const seller = await makeUser(db, "Zero Margin Collection Seller");
    const buyer = await makeUser(db, "Zero Margin Collection Buyer");
    const sellerLocationId = await makeLocation(seller);
    const productId = await makeProduct(seller, "Zero Margin Collection Toy", sellerLocationId);
    const r = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]));

    const rows = await asUser(db, admin, () => db.query<Record<string, string | number>>(`select * from public.list_delivery_financial_transactions()`));
    const row = rows.rows.find((x) => x.order_id === r.rows[0].order_id)!;
    expect(Number(row.provider_delivery_cost_cents)).toBe(0);
    expect(Number(row.buyer_delivery_fee_cents)).toBe(0);
    expect(Number(row.delivery_margin_cents)).toBe(0);
  });

  it("18. delivery margin is always buyer_delivery_fee - provider_delivery_cost, never confused with marketplace commission", async () => {
    const { orderId } = await makeMarkupOrder(6000, 2500); // 25%
    const rows = await asUser(db, admin, () => db.query<Record<string, string | number>>(`select * from public.list_delivery_financial_transactions()`));
    const row = rows.rows.find((r) => r.order_id === orderId)!;
    const expectedMargin = Number(row.buyer_delivery_fee_cents) - Number(row.provider_delivery_cost_cents);
    expect(Number(row.delivery_margin_cents)).toBe(expectedMargin);
    // Commission (marketplace fee on the product) is a completely
    // separate figure, unaffected by and never summed into margin.
    const order = await db.query<{ commission_amount_cents: string }>(`select commission_amount_cents from public.orders where id = $1`, [orderId]);
    expect(Number(order.rows[0].commission_amount_cents)).toBe(6000); // 12% of the fixed R500 subtotal
    expect(Number(order.rows[0].commission_amount_cents)).not.toBe(Number(row.delivery_margin_cents));
  });

  it("regression: anon still cannot read anything from orders or delivery_quotes at all", async () => {
    const { orderId } = await makeMarkupOrder(5000, 1000);
    const seen = await asAnon(db, () => db.query(`select id from public.orders where id = $1`, [orderId]));
    expect(seen.rows).toHaveLength(0);
  });
});
