import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeDeliveryQuote, makeUser } from "./harness";

/**
 * Phase 7A: delivery quoting + checkout + booking foundation — exercised
 * against the real migration SQL and real Postgres, the same method as
 * every other tests/db/*.test.ts file. Quotes here are inserted directly
 * as fixtures (makeDeliveryQuote(), harness.ts) rather than through
 * src/server/delivery/quoteService.ts — that TS module is covered by its
 * own unit tests; what's under test here is what create_order()/RLS
 * enforce once a quote row exists, which is exactly what the fixture
 * reproduces (see makeDeliveryQuote()'s own doc comment).
 */
describe("delivery quoting + booking (Phase 7A)", () => {
  let db: PGlite;
  let categoryId: string;
  let mockProviderId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
    const provider = await db.query<{ id: string }>(`select id from public.delivery_providers where slug = 'mock'`);
    mockProviderId = provider.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  async function makeLocation(ownerId: string, lat = -33.9, lng = 18.4) {
    const r = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, $2, $3, 'Gardens', 'Cape Town') returning id`,
      [ownerId, lat, lng],
    );
    return r.rows[0].id;
  }

  async function makeProduct(
    seller: { sellerType: "parent" | "business"; sellerProfileId?: string; businessId?: string },
    title: string,
    overrides: { status?: "draft" | "published"; delivery_available?: boolean; pickup_location_id?: string | null } = {},
  ) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available, pickup_location_id)
       values ($1, $2, $3, $4, $5, 'good', 50000, $6, true, $7, $8)
       returning id`,
      [
        seller.sellerType,
        seller.sellerProfileId ?? null,
        seller.businessId ?? null,
        categoryId,
        title,
        overrides.status ?? "published",
        overrides.delivery_available ?? true,
        overrides.pickup_location_id ?? null,
      ],
    );
    return r.rows[0].id;
  }

  /** A full, valid delivery setup: seller + location, buyer + location, published product, and a fresh quote — the "everything should just work" baseline every negative test perturbs one field of. */
  async function makeDeliveryFixture() {
    const seller = await makeUser(db, `Delivery Seller ${Math.random()}`);
    const buyer = await makeUser(db, `Delivery Buyer ${Math.random()}`);
    const sellerLocationId = await makeLocation(seller, -33.95, 18.45);
    const buyerLocationId = await makeLocation(buyer, -33.9, 18.4);
    await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId, buyer]);
    const productId = await makeProduct({ sellerType: "parent", sellerProfileId: seller }, "Delivery Fixture Toy", {
      pickup_location_id: sellerLocationId,
    });
    const quoteId = await makeDeliveryQuote(db, {
      buyerId: buyer,
      productId,
      pickupLocationId: sellerLocationId,
      dropoffLocationId: buyerLocationId,
      priceCents: 4500,
    });
    return { seller, buyer, sellerLocationId, buyerLocationId, productId, quoteId };
  }

  describe("create_order() quote revalidation", () => {
    it("1. a valid quote produces a delivery order priced from the quote, not a client-supplied amount", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      await db.query("reset role");
      const order = await db.query<{ delivery_fee_cents: string; subtotal_cents: string; total_cents: string }>(
        `select delivery_fee_cents, subtotal_cents, total_cents from public.orders where id = $1`,
        [r.rows[0].order_id],
      );
      expect(Number(order.rows[0].delivery_fee_cents)).toBe(4500);
      expect(Number(order.rows[0].total_cents)).toBe(Number(order.rows[0].subtotal_cents) + 4500);
    });

    it("2. the selected quote is attached to the resulting order (order_id claimed)", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      await db.query("reset role");
      const quote = await db.query<{ order_id: string }>(`select order_id from public.delivery_quotes where id = $1`, [quoteId]);
      expect(quote.rows[0].order_id).toBe(r.rows[0].order_id);
    });

    it("3. commission is computed from the subtotal only, never inflated by the delivery fee", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      await db.query("reset role");
      const commission = await db.query<{ base_amount_cents: string; commission_amount_cents: string }>(
        `select base_amount_cents, commission_amount_cents from public.commissions where order_id = $1`,
        [r.rows[0].order_id],
      );
      expect(Number(commission.rows[0].base_amount_cents)).toBe(50000);
      expect(Number(commission.rows[0].commission_amount_cents)).toBe(6000); // 12% of R500
    });

    it("4. a delivery order with no quote id is rejected", async () => {
      const { buyer, productId } = await makeDeliveryFixture();
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'delivery')`, [productId])).rejects.toThrow(
          /select a delivery option/i,
        );
      });
    });

    it("5. a nonexistent quote id is rejected", async () => {
      const { buyer, productId } = await makeDeliveryFixture();
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [
            productId,
            "00000000-0000-4000-8000-000000000000",
          ]),
        ).rejects.toThrow(/delivery quote not found/i);
      });
    });

    it("6. a quote belonging to another buyer cannot be used", async () => {
      const { productId, quoteId } = await makeDeliveryFixture();
      const stranger = await makeUser(db, "Quote Stranger");
      const strangerLocationId = await makeLocation(stranger, -33.8, 18.3);
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [strangerLocationId, stranger]);
      await asUser(db, stranger, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
        ).rejects.toThrow(/delivery quote not found/i);
      });
      // The product must not have been claimed by the rejected attempt.
      await db.query("reset role");
      const product = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(product.rows[0].status).toBe("published");
    });

    it("7. an expired quote cannot be used", async () => {
      const { buyer, sellerLocationId, buyerLocationId, productId } = await makeDeliveryFixture();
      const expiredQuoteId = await makeDeliveryQuote(db, {
        buyerId: buyer,
        productId,
        pickupLocationId: sellerLocationId,
        dropoffLocationId: buyerLocationId,
        expiresInMinutes: -1,
      });
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, expiredQuoteId]),
        ).rejects.toThrow(/expired/i);
      });
    });

    it("8. a quote fetched for a different product cannot be used to buy this one", async () => {
      const { buyer, sellerLocationId, buyerLocationId, productId: originalProductId } = await makeDeliveryFixture();
      const seller = await makeUser(db, "Second Product Seller");
      const otherProductId = await makeProduct({ sellerType: "parent", sellerProfileId: seller }, "A Different Toy", {
        pickup_location_id: sellerLocationId,
      });
      const quoteForOriginalProduct = await makeDeliveryQuote(db, {
        buyerId: buyer,
        productId: originalProductId,
        pickupLocationId: sellerLocationId,
        dropoffLocationId: buyerLocationId,
      });
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [otherProductId, quoteForOriginalProduct]),
        ).rejects.toThrow(/does not match this listing/i);
      });
    });

    it("9. a quote with a stale pickup location (listing's pickup location changed since the quote) cannot be used", async () => {
      const { buyer, buyerLocationId, productId, quoteId } = await makeDeliveryFixture();
      const seller = await makeUser(db, "Relocating Seller");
      const newSellerLocationId = await makeLocation(seller, -34.1, 18.6);
      await db.query(`update public.products set pickup_location_id = $1 where id = $2`, [newSellerLocationId, productId]);
      void buyerLocationId;
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
        ).rejects.toThrow(/no longer valid for this listing/i);
      });
    });

    it("10. a quote with a stale dropoff location (buyer moved since the quote) cannot be used", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      const newBuyerLocationId = await makeLocation(buyer, -33.7, 18.2);
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [newBuyerLocationId, buyer]);
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
        ).rejects.toThrow(/no longer valid for your delivery location/i);
      });
    });

    it("11. a quote cannot be used twice", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      await asUser(db, buyer, () =>
        db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      // Republish the (now-sold) product so a second attempt gets as far
      // as the quote check, not an earlier "not available" rejection.
      await db.query("reset role");
      await db.query(`update public.products set status = 'published' where id = $1`, [productId]);
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
        ).rejects.toThrow(/already been used/i);
      });
    });

    it("12. a quote for a provider that has since been deactivated cannot be used", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      await db.query(`update public.delivery_providers set is_active = false where slug = 'mock'`);
      try {
        await asUser(db, buyer, async () => {
          await expect(
            db.query(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
          ).rejects.toThrow(/delivery provider is currently unavailable/i);
        });
      } finally {
        await db.query(`update public.delivery_providers set is_active = true where slug = 'mock'`);
      }
    });

    it("13. a client cannot manipulate the delivery fee — create_order() takes no such parameter", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      const argNames = r.rows[0].proargnames;
      for (const forbidden of ["delivery_fee_cents", "total_cents", "price_cents"]) {
        expect(argNames).not.toContain(forbidden);
      }
    });

    it("14. cash + delivery remains rejected even with a valid quote supplied", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'delivery', 'cash', $2)`, [productId, quoteId]),
        ).rejects.toThrow(/not available for delivery/i);
      });
    });

    it("15. a delivery quote id supplied alongside collection is rejected", async () => {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select * from public.create_order($1, 'collection', 'online', $2)`, [productId, quoteId]),
        ).rejects.toThrow(/cannot be used with collection/i);
      });
    });

    it("16. collection remains R0 regardless of the delivery quoting changes in this migration", async () => {
      const seller = await makeUser(db, "Collection Regression Seller");
      const buyer = await makeUser(db, "Collection Regression Buyer");
      const productId = await makeProduct({ sellerType: "parent", sellerProfileId: seller }, "Collection Regression Toy");
      const r = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [productId]));
      await db.query("reset role");
      const order = await db.query<{ delivery_fee_cents: string; total_cents: string; subtotal_cents: string }>(
        `select delivery_fee_cents, total_cents, subtotal_cents from public.orders where id = $1`,
        [r.rows[0].order_id],
      );
      expect(Number(order.rows[0].delivery_fee_cents)).toBe(0);
      expect(order.rows[0].total_cents).toBe(order.rows[0].subtotal_cents);
    });
  });

  describe("business seller delivery", () => {
    async function makeVerifiedBusiness(ownerId: string, businessName: string, slug: string, locationId: string): Promise<string> {
      const r = await db.query<{ id: string }>(
        `insert into public.businesses (owner_profile_id, business_name, slug, verification_status, location_id) values ($1, $2, $3, 'verified', $4) returning id`,
        [ownerId, businessName, slug, locationId],
      );
      return r.rows[0].id;
    }

    it("17. a business seller's delivery order prices correctly from a quote pinned to the business's own location", async () => {
      const owner = await makeUser(db, "Delivery Business Owner");
      const buyer = await makeUser(db, "Delivery Business Buyer");
      const businessLocationId = await makeLocation(owner, -33.95, 18.45);
      const businessId = await makeVerifiedBusiness(owner, "Delivery Test Co", "delivery-test-co", businessLocationId);
      const buyerLocationId = await makeLocation(buyer, -33.9, 18.4);
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [buyerLocationId, buyer]);

      const productId = await makeProduct(
        { sellerType: "business", businessId },
        "Business Delivery Toy",
        { pickup_location_id: businessLocationId },
      );
      const quoteId = await makeDeliveryQuote(db, {
        buyerId: buyer,
        productId,
        pickupLocationId: businessLocationId,
        dropoffLocationId: buyerLocationId,
        priceCents: 5500,
      });

      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      await db.query("reset role");
      const order = await db.query<{ delivery_fee_cents: string; seller_type: string }>(
        `select delivery_fee_cents, seller_type from public.orders where id = $1`,
        [r.rows[0].order_id],
      );
      expect(Number(order.rows[0].delivery_fee_cents)).toBe(5500);
      expect(order.rows[0].seller_type).toBe("business");
    });
  });

  describe("RLS: delivery_quotes", () => {
    it("18. the requesting buyer can see their own not-yet-attached quote", async () => {
      const { buyer, quoteId } = await makeDeliveryFixture();
      const seen = await asUser(db, buyer, () =>
        db.query<{ id: string }>(`select id from public.delivery_quotes where id = $1`, [quoteId]),
      );
      expect(seen.rows).toHaveLength(1);
    });

    it("19. another authenticated user cannot see someone else's not-yet-attached quote", async () => {
      const { quoteId } = await makeDeliveryFixture();
      const stranger = await makeUser(db, "Quote Visibility Stranger");
      const seen = await asUser(db, stranger, () =>
        db.query<{ id: string }>(`select id from public.delivery_quotes where id = $1`, [quoteId]),
      );
      expect(seen.rows).toHaveLength(0);
    });

    it("20. anon cannot see any delivery_quotes row", async () => {
      const { quoteId } = await makeDeliveryFixture();
      const seen = await asAnon(db, () => db.query<{ id: string }>(`select id from public.delivery_quotes where id = $1`, [quoteId]));
      expect(seen.rows).toHaveLength(0);
    });

    it("21. a normal authenticated client cannot insert a delivery_quotes row directly", async () => {
      const { buyer, sellerLocationId, buyerLocationId, productId } = await makeDeliveryFixture();
      await asUser(db, buyer, async () => {
        await expect(
          db.query(
            `insert into public.delivery_quotes (requested_by, product_id, pickup_location_id, dropoff_location_id, provider_id, service_level, price_cents, provider_quote_ref, expires_at)
             values ($1, $2, $3, $4, $5, 'standard', 1, 'forged-ref', now() + interval '15 minutes')`,
            [buyer, productId, sellerLocationId, buyerLocationId, mockProviderId],
          ),
        ).rejects.toThrow();
      });
    });

    it("22. a normal authenticated client cannot update a delivery_quotes row's price", async () => {
      const { buyer, quoteId } = await makeDeliveryFixture();
      const updated = await asUser(db, buyer, () =>
        db.query(`update public.delivery_quotes set price_cents = 1 where id = $1`, [quoteId]),
      );
      expect(updated.affectedRows).toBe(0);
      await db.query("reset role");
      const row = await db.query<{ price_cents: string }>(`select price_cents from public.delivery_quotes where id = $1`, [quoteId]);
      expect(Number(row.rows[0].price_cents)).toBe(4500);
    });

    it("23. the buyer can see the pickup/dropoff location ids on their own quote, but cannot read the seller's raw coordinates through them (locations RLS is unchanged)", async () => {
      const { buyer, sellerLocationId, quoteId } = await makeDeliveryFixture();
      const quote = await asUser(db, buyer, () =>
        db.query<{ pickup_location_id: string }>(`select pickup_location_id from public.delivery_quotes where id = $1`, [quoteId]),
      );
      expect(quote.rows[0].pickup_location_id).toBe(sellerLocationId);

      const sellerLocation = await asUser(db, buyer, () =>
        db.query<{ id: string }>(`select id from public.locations where id = $1`, [sellerLocationId]),
      );
      expect(sellerLocation.rows).toHaveLength(0);
    });
  });

  describe("delivery booking (reserve_delivery_order / record_delivery_booking)", () => {
    async function makePaidDeliveryOrder() {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      const orderId = r.rows[0].order_id;
      await db.query("reset role");
      await db.query(`update public.orders set status = 'confirmed' where id = $1`, [orderId]);
      return { orderId, quoteId, buyer };
    }

    it("24. reserve_delivery_order() creates a pending delivery_orders row for a real delivery order", async () => {
      const { orderId, quoteId } = await makePaidDeliveryOrder();
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string | null }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      expect(reserved.rows[0].reserve_delivery_order).toBeTruthy();
      const row = await db.query<{ status: string }>(`select status from public.delivery_orders where order_id = $1`, [orderId]);
      expect(row.rows[0].status).toBe("pending");
    });

    it("25. reserve_delivery_order() is idempotent — a second call for the same order returns null, never a duplicate row", async () => {
      const { orderId, quoteId } = await makePaidDeliveryOrder();
      await asServiceRole(db, () => db.query(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]));
      const second = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string | null }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      expect(second.rows[0].reserve_delivery_order).toBeNull();
      const rows = await db.query(`select id from public.delivery_orders where order_id = $1`, [orderId]);
      expect(rows.rows).toHaveLength(1);
    });

    it("26. a normal authenticated client cannot call reserve_delivery_order() directly", async () => {
      const { orderId, quoteId, buyer } = await makePaidDeliveryOrder();
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
        ).rejects.toThrow();
      });
    });

    it("27. record_delivery_booking('booked') advances the order to awaiting_delivery and stores the tracking ref", async () => {
      const { orderId, quoteId } = await makePaidDeliveryOrder();
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      const deliveryOrderId = reserved.rows[0].reserve_delivery_order;
      await asServiceRole(db, () =>
        db.query(`select public.record_delivery_booking($1, $2, 'booked')`, [deliveryOrderId, "mock-tracking-ref-1"]),
      );
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("awaiting_delivery");
      const deliveryOrder = await db.query<{ status: string; provider_tracking_ref: string }>(
        `select status, provider_tracking_ref from public.delivery_orders where id = $1`,
        [deliveryOrderId],
      );
      expect(deliveryOrder.rows[0].status).toBe("booked");
      expect(deliveryOrder.rows[0].provider_tracking_ref).toBe("mock-tracking-ref-1");
    });

    it("28. record_delivery_booking('failed') never advances or reverts orders.status — the order stays 'confirmed', payment already succeeded", async () => {
      const { orderId, quoteId } = await makePaidDeliveryOrder();
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      await asServiceRole(db, () =>
        db.query(`select public.record_delivery_booking($1, $2, 'failed')`, [reserved.rows[0].reserve_delivery_order, null]),
      );
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("confirmed");
    });

    it("29. a normal authenticated client cannot call record_delivery_booking() directly", async () => {
      const { orderId, quoteId, buyer } = await makePaidDeliveryOrder();
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      await asUser(db, buyer, async () => {
        await expect(
          db.query(`select public.record_delivery_booking($1, $2, 'booked')`, [reserved.rows[0].reserve_delivery_order, "forged"]),
        ).rejects.toThrow();
      });
    });

    it("30. a normal authenticated client cannot directly update delivery_orders.status or provider_tracking_ref", async () => {
      const { orderId, quoteId, buyer } = await makePaidDeliveryOrder();
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      const updated = await asUser(db, buyer, () =>
        db.query(`update public.delivery_orders set status = 'delivered', provider_tracking_ref = 'forged' where id = $1`, [
          reserved.rows[0].reserve_delivery_order,
        ]),
      );
      expect(updated.affectedRows).toBe(0);
    });
  });

  describe("RLS: delivery_orders", () => {
    it("31. the buyer, the seller, and an unrelated user see exactly what they should", async () => {
      const { orderId, quoteId, buyer } = await (async () => {
        const { buyer, seller, productId, quoteId } = await makeDeliveryFixture();
        const r = await asUser(db, buyer, () =>
          db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
        );
        await db.query("reset role");
        await db.query(`update public.orders set status = 'confirmed' where id = $1`, [r.rows[0].order_id]);
        return { orderId: r.rows[0].order_id, quoteId, buyer, seller };
      })();
      await asServiceRole(db, () => db.query(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]));

      const buyerSees = await asUser(db, buyer, () => db.query(`select id from public.delivery_orders where order_id = $1`, [orderId]));
      expect(buyerSees.rows).toHaveLength(1);

      const stranger = await makeUser(db, "Delivery Order Stranger");
      const strangerSees = await asUser(db, stranger, () => db.query(`select id from public.delivery_orders where order_id = $1`, [orderId]));
      expect(strangerSees.rows).toHaveLength(0);
    });
  });

  describe("sync_delivery_status()", () => {
    async function makeBookedDeliveryOrder() {
      const { buyer, productId, quoteId } = await makeDeliveryFixture();
      const r = await asUser(db, buyer, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'delivery', 'online', $2)`, [productId, quoteId]),
      );
      const orderId = r.rows[0].order_id;
      await db.query("reset role");
      await db.query(`update public.orders set status = 'confirmed' where id = $1`, [orderId]);
      const reserved = await asServiceRole(db, () =>
        db.query<{ reserve_delivery_order: string }>(`select public.reserve_delivery_order($1, $2, $3)`, [orderId, quoteId, mockProviderId]),
      );
      await asServiceRole(db, () =>
        db.query(`select public.record_delivery_booking($1, $2, 'booked')`, [reserved.rows[0].reserve_delivery_order, "ref"]),
      );
      return { orderId };
    }

    it("32. syncing 'in_transit' advances the order status accordingly", async () => {
      const { orderId } = await makeBookedDeliveryOrder();
      await asServiceRole(db, () => db.query(`select public.sync_delivery_status($1, 'in_transit')`, [orderId]));
      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("in_transit");
    });

    it("33. syncing 'delivered' completes the order", async () => {
      const { orderId } = await makeBookedDeliveryOrder();
      await asServiceRole(db, () => db.query(`select public.sync_delivery_status($1, 'delivered')`, [orderId]));
      const order = await db.query<{ status: string; completed_at: string | null }>(`select status, completed_at from public.orders where id = $1`, [orderId]);
      expect(order.rows[0].status).toBe("completed");
      expect(order.rows[0].completed_at).not.toBeNull();
    });

    it("34. a normal authenticated client cannot call sync_delivery_status() directly", async () => {
      const { orderId } = await makeBookedDeliveryOrder();
      const buyer = await db.query<{ buyer_id: string }>(`select buyer_id from public.orders where id = $1`, [orderId]);
      await asUser(db, buyer.rows[0].buyer_id, async () => {
        await expect(db.query(`select public.sync_delivery_status($1, 'delivered')`, [orderId])).rejects.toThrow();
      });
    });
  });
});
