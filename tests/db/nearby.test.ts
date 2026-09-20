import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 3B: Nearby + location privacy — exercised against the real
 * migration SQL and real Postgres/PostGIS, the same method as
 * tests/db/search.test.ts and tests/db/rls.test.ts. The 12 numbered
 * describe blocks below map 1:1 to the explicit privacy tests this
 * phase's spec requires; everything after them is functional coverage
 * (filters, sort, pagination, radius boundaries) using the same fixture
 * geography.
 *
 * Fixture geography, all real Cape Town-area coordinates so distances are
 * meaningful, not just "some number":
 *   buyerPoint / aliceLoc — Cape Town CBD (-33.9249, 18.4241) — 0 km
 *   bobLoc                — ~7 km south   — inside 10 km, outside 5 km
 *   carolLoc              — ~40 km south  — inside 50 km, outside 25 km
 *   daveLoc               — ~222 km south — outside every supported radius
 */
describe("Nearby + location privacy", () => {
  let db: PGlite;
  let alice: string; // seller, own location = buyer's exact point (0 km)
  let bob: string; // seller, ~7 km away
  let carol: string; // seller, ~40 km away
  let dave: string; // seller, ~222 km away (always out of range)
  let buyer: string; // authenticated buyer, no listings of their own
  let categoryId: string;
  let aliceLocId: string;
  let bobLocId: string;
  let carolLocId: string;
  let daveLocId: string;
  let alicePublishedId: string;
  let aliceDraftId: string;
  let aliceArchivedId: string;
  let bobPublishedId: string;
  let carolPublishedId: string;
  let davePublishedId: string;
  let noLocationPublishedId: string;

  const buyerPoint = { lat: -33.9249, lng: 18.4241 };

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    alice = await makeUser(db, "Nearby Alice");
    bob = await makeUser(db, "Nearby Bob");
    carol = await makeUser(db, "Nearby Carol");
    dave = await makeUser(db, "Nearby Dave");
    buyer = await makeUser(db, "Nearby Buyer");

    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;

    async function makeLocation(owner: string, lat: number, lng: number, suburb: string) {
      const r = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude, suburb, city, formatted_address)
         values ($1, $2, $3, $4, 'Cape Town', $5) returning id`,
        [owner, lat, lng, suburb, `123 Private Street, ${suburb}`],
      );
      return r.rows[0].id;
    }

    aliceLocId = await makeLocation(alice, buyerPoint.lat, buyerPoint.lng, "Gardens");
    bobLocId = await makeLocation(bob, buyerPoint.lat + 0.063, buyerPoint.lng, "Muizenberg");
    carolLocId = await makeLocation(carol, buyerPoint.lat + 0.36, buyerPoint.lng, "Fish Hoek");
    daveLocId = await makeLocation(dave, buyerPoint.lat + 2.0, buyerPoint.lng, "Hermanus");

    async function makeProduct(
      seller: string,
      title: string,
      status: "draft" | "published" | "archived",
      locationId: string | null,
      overrides: { price_cents?: number; collection_available?: boolean; delivery_available?: boolean } = {},
    ) {
      const r = await db.query<{ id: string }>(
        `insert into public.products
           (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status, collection_available, delivery_available)
         values ('parent', $1, $2, $3, 'good', $4, $5, $6, $7, $8)
         returning id`,
        [
          seller,
          categoryId,
          title,
          overrides.price_cents ?? 10000,
          locationId,
          status,
          overrides.collection_available ?? true,
          overrides.delivery_available ?? false,
        ],
      );
      return r.rows[0].id;
    }

    alicePublishedId = await makeProduct(alice, "Alice Published Toy", "published", aliceLocId);
    aliceDraftId = await makeProduct(alice, "Alice Draft Toy", "draft", aliceLocId);
    aliceArchivedId = await makeProduct(alice, "Alice Archived Toy", "archived", aliceLocId);
    bobPublishedId = await makeProduct(bob, "Bob Published Toy", "published", bobLocId, { price_cents: 20000 });
    carolPublishedId = await makeProduct(carol, "Carol Published Toy", "published", carolLocId, {
      price_cents: 30000,
      collection_available: false,
      delivery_available: true,
    });
    davePublishedId = await makeProduct(dave, "Dave Published Toy", "published", daveLocId);
    noLocationPublishedId = await makeProduct(alice, "No Pickup Point Toy", "published", null);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  // 1. Anonymous users cannot query exact seller coordinates.
  describe("1. anonymous users cannot query exact seller coordinates", () => {
    it("raw locations table is empty for anon, for every row, not just one seller's", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select * from public.locations`);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("anon cannot select even a single known location id's lat/lng directly", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select latitude, longitude from public.locations where id = $1`, [aliceLocId]);
        expect(r.rows).toHaveLength(0);
      });
    });
  });

  // 2. Authenticated users cannot query another seller's exact coordinates.
  describe("2. authenticated users cannot query another seller's exact coordinates", () => {
    it("bob cannot select alice's location row at all", async () => {
      await asUser(db, bob, async () => {
        const r = await db.query(`select * from public.locations where id = $1`, [aliceLocId]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("bob can only ever select his own location row, never anyone else's, from an unfiltered select *", async () => {
      await asUser(db, bob, async () => {
        const r = await db.query<{ id: string }>(`select id from public.locations`);
        expect(r.rows.map((row) => row.id)).toEqual([bobLocId]);
      });
    });
  });

  // 3. Public listing queries contain no exact latitude/longitude.
  describe("3. public listing queries contain no exact latitude/longitude", () => {
    it("product_locations_public never has a latitude/longitude/formatted_address column", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select * from public.product_locations_public where product_id = $1`, [alicePublishedId]);
        const cols = Object.keys(r.rows[0] ?? {});
        expect(cols).not.toEqual(expect.arrayContaining(["latitude", "longitude", "formatted_address"]));
        expect(cols).toEqual(expect.arrayContaining(["suburb", "city"]));
      });
    });
  });

  // 4. Public search results contain no exact latitude/longitude.
  describe("4. public search results contain no exact latitude/longitude", () => {
    it("search_products() never returns a location-identifying column at all", async () => {
      await db.query("reset role");
      const r = await db.query<{ column_name: string }>(`select unnest(proargnames) as column_name from pg_proc where proname = 'search_products'`);
      const names = r.rows.map((row) => row.column_name);
      for (const forbidden of ["latitude", "longitude", "pickup_location_id", "formatted_address"]) {
        expect(names).not.toContain(forbidden);
      }
    });
  });

  // 5. Nearby results contain only approximate distance.
  describe("5. nearby results contain only approximate distance, never exact coordinates", () => {
    it("search_nearby_products()'s own declared return columns never include latitude/longitude/address/location id", async () => {
      await db.query("reset role");
      const r = await db.query<{ column_name: string }>(
        `select unnest(proargnames) as column_name from pg_proc where proname = 'search_nearby_products'`,
      );
      const names = r.rows.map((row) => row.column_name);
      for (const forbidden of ["latitude", "longitude", "formatted_address", "pickup_location_id", "location_id", "address"]) {
        expect(names).not.toContain(forbidden);
      }
    });

    it("a real response's columns are exactly the documented public-safe set", async () => {
      await asAnon(db, async () => {
        const r = await db.query<Record<string, unknown>>(
          `select * from public.search_nearby_products($1, $2, 50) limit 1`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        expect(r.rows.length).toBeGreaterThan(0);
        expect(Object.keys(r.rows[0]).sort()).toEqual(
          [
            "id",
            "title",
            "price_cents",
            "currency",
            "condition",
            "category_id",
            "collection_available",
            "delivery_available",
            "created_at",
            "cover_image_path",
            "distance_km",
            "suburb",
            "city",
            "total_count",
          ].sort(),
        );
      });
    });

    it("distance_km is rounded to 1 decimal place, not raw full-precision metres", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ distance_km: string }>(
          `select distance_km from public.search_nearby_products($1, $2, 10, null) where id = $3`,
          [buyerPoint.lat, buyerPoint.lng, alicePublishedId],
        );
        expect(r.rows[0].distance_km).toMatch(/^\d+(\.\d)?$/);
      });
    });
  });

  // 6. A user cannot manipulate a listing to reference another seller's private location.
  describe("6. a user cannot manipulate a listing to reference another seller's private location", () => {
    it("bob's INSERT referencing alice's location id is rejected by RLS, not silently dropped", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
             values ('parent', $1, $2, 'Bob Forged Location', 'good', 5000, $3, 'draft')`,
            [bob, categoryId, aliceLocId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
      // Confirm nothing was actually inserted despite the throw.
      await db.query("reset role");
      const check = await db.query(`select 1 from public.products where title = 'Bob Forged Location'`);
      expect(check.rows).toHaveLength(0);
    });
  });

  // 7. A seller cannot attach another seller's location to their own listing.
  describe("7. a seller cannot attach another seller's location to their own listing", () => {
    it("bob's UPDATE of his own listing to point at alice's location id is rejected by the WITH CHECK clause", async () => {
      // Unlike a USING mismatch (a row that isn't even selected for
      // update, which silently affects 0 rows), this row IS bob's own —
      // it passes USING — so the failure is a WITH CHECK violation on
      // the *new* row, which Postgres throws rather than silently
      // dropping (see tests/db/rls.test.ts's header note on this
      // distinction).
      await asUser(db, bob, async () => {
        await expect(
          db.query(`update public.products set pickup_location_id = $1 where id = $2`, [aliceLocId, bobPublishedId]),
        ).rejects.toThrow(/row-level security/i);
      });

      await db.query("reset role");
      const check = await db.query<{ pickup_location_id: string }>(
        `select pickup_location_id from public.products where id = $1`,
        [bobPublishedId],
      );
      expect(check.rows[0].pickup_location_id).toBe(bobLocId); // unchanged
    });
  });

  // 8. A seller cannot change another seller's location.
  describe("8. a seller cannot change another seller's location", () => {
    it("bob's UPDATE of alice's location row affects 0 rows", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`update public.locations set latitude = 0, longitude = 0 where id = $1`, [aliceLocId]),
      );
      expect(r.affectedRows).toBe(0);

      await db.query("reset role");
      const check = await db.query<{ latitude: number }>(`select latitude from public.locations where id = $1`, [aliceLocId]);
      expect(check.rows[0].latitude).toBeCloseTo(buyerPoint.lat);
    });
  });

  // 9. A seller cannot retrieve another seller's private address through an alternate query/path.
  describe("9. a seller cannot retrieve another seller's private address through an alternate query/path", () => {
    it("a join from bob's own visible products into locations still yields nothing for alice's location", async () => {
      await asUser(db, bob, async () => {
        // bob can read alice's *published* product (public), but joining
        // from it into locations must still hit RLS on the locations
        // table itself — the join path doesn't bypass it.
        const r = await db.query(
          `select l.formatted_address from public.products p join public.locations l on l.id = p.pickup_location_id where p.id = $1`,
          [alicePublishedId],
        );
        expect(r.rows).toHaveLength(0);
      });
    });

    it("product_locations_public exposes no formatted_address for any product, including bob's own", async () => {
      await asUser(db, bob, async () => {
        const r = await db.query(`select * from public.product_locations_public where product_id = $1`, [bobPublishedId]);
        expect(Object.keys(r.rows[0] ?? {})).not.toContain("formatted_address");
      });
    });
  });

  // 10. SQL/RPC parameters cannot be manipulated to bypass the privacy boundary.
  describe("10. SQL/RPC parameters cannot be manipulated to bypass the privacy boundary", () => {
    it("an adversarial sort_key never errors, never exposes raw ordering, and never crashes the function", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.search_nearby_products($1, $2, 50, null, null, null, null, false, false, $3)`,
          [buyerPoint.lat, buyerPoint.lng, "latitude); DROP TABLE locations; --"],
        );
        expect(r.rows.length).toBeGreaterThan(0);
      });
      await db.query("reset role");
      const stillThere = await db.query(`select 1 from information_schema.tables where table_name = 'locations'`);
      expect(stillThere.rows).toHaveLength(1);
    });

    it("an out-of-range radius_km is clamped, not passed through to widen the search unbounded", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.search_nearby_products($1, $2, 999999999)`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        const ids = r.rows.map((row) => row.id);
        // Clamped to the 10 km default — dave (~222 km) must not appear.
        expect(ids).not.toContain(davePublishedId);
      });
    });

    it("a negative page_offset is clamped to 0, not used to underflow/wrap the query", async () => {
      await asAnon(db, async () => {
        const r = await db.query(
          `select id from public.search_nearby_products($1, $2, 50, null, null, null, null, false, false, 'distance', 24, -50)`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        expect(r.rows.length).toBeGreaterThan(0);
      });
    });

    it("category_ids cannot be used to smuggle a draft/archived listing into view", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.search_nearby_products($1, $2, 50, $3)`,
          [buyerPoint.lat, buyerPoint.lng, [categoryId]],
        );
        const ids = r.rows.map((row) => row.id);
        expect(ids).not.toContain(aliceDraftId);
        expect(ids).not.toContain(aliceArchivedId);
      });
    });
  });

  // 11. Nearby queries cannot return unpublished listings.
  describe("11. nearby queries cannot return unpublished listings", () => {
    it("alice's draft, at the buyer's exact location (0 km), never appears at any radius", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        expect(r.rows.map((row) => row.id)).not.toContain(aliceDraftId);
      });
    });

    it("not even the draft's own owner sees it via Nearby — this is the public browse path, not the seller dashboard", async () => {
      await asUser(db, alice, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        expect(r.rows.map((row) => row.id)).not.toContain(aliceDraftId);
      });
    });
  });

  // 12. Nearby queries cannot return archived listings.
  describe("12. nearby queries cannot return archived listings", () => {
    it("alice's archived listing, at the buyer's exact location (0 km), never appears at any radius", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        expect(r.rows.map((row) => row.id)).not.toContain(aliceArchivedId);
      });
    });
  });

  // --- Functional coverage beyond the 12 required privacy tests --------

  describe("radius filtering", () => {
    it("5 km catches only alice (0 km)", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 5)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        expect(r.rows.map((row) => row.id)).toEqual([alicePublishedId]);
      });
    });

    it("10 km catches alice and bob but not carol or dave", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 10)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        const ids = r.rows.map((row) => row.id);
        expect(ids).toContain(alicePublishedId);
        expect(ids).toContain(bobPublishedId);
        expect(ids).not.toContain(carolPublishedId);
        expect(ids).not.toContain(davePublishedId);
      });
    });

    it("50 km catches alice, bob, and carol but not dave", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        const ids = r.rows.map((row) => row.id);
        expect(ids).toContain(alicePublishedId);
        expect(ids).toContain(bobPublishedId);
        expect(ids).toContain(carolPublishedId);
        expect(ids).not.toContain(davePublishedId);
      });
    });

    it("an unsupported radius value (e.g. 15) falls back to the 10 km default, not the nearest option", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 15)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        const ids = r.rows.map((row) => row.id);
        expect(ids).not.toContain(carolPublishedId); // 40 km — would be in range if 15 were honored as "wider than 10"
      });
    });
  });

  describe("a listing with no pickup location never appears in Nearby, at any radius", () => {
    it("noLocationPublishedId is excluded even at the widest supported radius", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [
          buyerPoint.lat,
          buyerPoint.lng,
        ]);
        expect(r.rows.map((row) => row.id)).not.toContain(noLocationPublishedId);
      });
    });

    it("but the same listing still appears in ordinary search_products(), unaffected by having no pickup point", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(`select id from public.search_products($1)`, ["No Pickup Point"]);
        expect(r.rows.map((row) => row.id)).toContain(noLocationPublishedId);
      });
    });
  });

  describe("distance sorting is performed by PostgreSQL, not the application", () => {
    it("sort_key='distance' returns nearest-first, matching real geography, not insertion order", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string; distance_km: string }>(
          `select id, distance_km from public.search_nearby_products($1, $2, 50, null, null, null, null, false, false, 'distance')`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        const distances = r.rows.map((row) => Number(row.distance_km));
        expect(distances).toEqual([...distances].sort((a, b) => a - b));
        expect(r.rows[0].id).toBe(alicePublishedId);
      });
    });

    it("price_asc and price_desc genuinely reorder nearby results (proving sort is real)", async () => {
      await asAnon(db, async () => {
        const asc = await db.query<{ price_cents: string }>(
          `select price_cents from public.search_nearby_products($1, $2, 50, null, null, null, null, false, false, 'price_asc')`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        const desc = await db.query<{ price_cents: string }>(
          `select price_cents from public.search_nearby_products($1, $2, 50, null, null, null, null, false, false, 'price_desc')`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        expect(asc.rows.map((r) => r.price_cents)).toEqual([...desc.rows.map((r) => r.price_cents)].reverse());
      });
    });
  });

  describe("filters preserved from search_products() also apply to Nearby", () => {
    it("collection_only excludes carol (delivery-only) within range", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.search_nearby_products($1, $2, 50, null, null, null, null, true)`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        expect(r.rows.map((row) => row.id)).not.toContain(carolPublishedId);
      });
    });

    it("delivery_only excludes alice and bob (collection-only) within range", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.search_nearby_products($1, $2, 50, null, null, null, null, false, true)`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        const ids = r.rows.map((row) => row.id);
        expect(ids).not.toContain(alicePublishedId);
        expect(ids).not.toContain(bobPublishedId);
        expect(ids).toContain(carolPublishedId);
      });
    });

    it("price range filters within the Nearby radius", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.search_nearby_products($1, $2, 50, null, 15000, 25000)`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        expect(r.rows.map((row) => row.id)).toEqual([bobPublishedId]);
      });
    });
  });

  describe("pagination", () => {
    it("total_count reflects only in-range, published rows — not the whole products table", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ total_count: string }>(
          `select total_count from public.search_nearby_products($1, $2, 50) limit 1`,
          [buyerPoint.lat, buyerPoint.lng],
        );
        expect(Number(r.rows[0].total_count)).toBe(3); // alice, bob, carol — not dave, not draft/archived, not no-location
      });
    });

    it("paging through every result never surfaces the draft/archived rows, regardless of offset", async () => {
      await asAnon(db, async () => {
        const allIds: string[] = [];
        for (let offset = 0; offset < 5; offset += 1) {
          const r = await db.query<{ id: string }>(
            `select id from public.search_nearby_products($1, $2, 50, null, null, null, null, false, false, 'distance', 1, $3)`,
            [buyerPoint.lat, buyerPoint.lng, offset],
          );
          allIds.push(...r.rows.map((row) => row.id));
        }
        expect(allIds).not.toContain(aliceDraftId);
        expect(allIds).not.toContain(aliceArchivedId);
      });
    });
  });

  describe("an authenticated user with no listings of their own gets the same guarantees as anon", () => {
    it("buyer (no listings, no locations) cannot read the raw locations table either", async () => {
      await asUser(db, buyer, async () => {
        const r = await db.query(`select * from public.locations`);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("buyer sees the same Nearby results anon would, for the same point and radius", async () => {
      const asBuyer = await asUser(db, buyer, () =>
        db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [buyerPoint.lat, buyerPoint.lng]),
      );
      const asAnonymous = await asAnon(db, () =>
        db.query<{ id: string }>(`select id from public.search_nearby_products($1, $2, 50)`, [buyerPoint.lat, buyerPoint.lng]),
      );
      expect(asBuyer.rows.map((r) => r.id).sort()).toEqual(asAnonymous.rows.map((r) => r.id).sort());
    });
  });

  describe("search_nearby_products() is SECURITY DEFINER — a deliberate, documented exception", () => {
    it("is SECURITY DEFINER, unlike search_products() — required because callers have no SELECT grant on locations at all", async () => {
      await db.query("reset role");
      const r = await db.query<{ prosecdef: boolean }>(`select prosecdef from pg_proc where proname = 'search_nearby_products'`);
      expect(r.rows[0].prosecdef).toBe(true);
    });
  });

  describe("products_pickup_location_id_idx exists and backs the Nearby join", () => {
    it("the index is present on products(pickup_location_id)", async () => {
      await db.query("reset role");
      const r = await db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'products'`);
      expect(r.rows.map((row) => row.indexname)).toContain("products_pickup_location_id_idx");
    });
  });
});
