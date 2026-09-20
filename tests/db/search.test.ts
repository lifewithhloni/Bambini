import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 3A: search_products() — exercised against the real migration
 * SQL and real Postgres, the same method as tests/db/rls.test.ts and
 * tests/db/listings.test.ts. This function is deliberately not
 * SECURITY DEFINER (see the migration) — it runs as the calling role,
 * so every test here is really proving "RLS + the function's own
 * status='published' filter agree," not bypassing RLS to fake a result.
 */
describe("search_products()", () => {
  let db: PGlite;
  let seller: string;
  let buyer: string;
  let clothingLeafId: string;
  let toysLeafId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    seller = await makeUser(db, "Search Test Seller");
    buyer = await makeUser(db, "Search Test Buyer");

    const clothing = await db.query<{ id: string }>(`select id from public.categories where slug = 'clothing-newborn' limit 1`);
    const toys = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    clothingLeafId = clothing.rows[0].id;
    toysLeafId = toys.rows[0].id;

    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, description, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, 'Published Stroller', 'A great stroller for babies', 'good', 50000, 'published', true, true)`,
      [seller, clothingLeafId],
    );

    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, description, condition, price_cents, status)
       values ('parent', $1, $2, 'Draft Stroller', 'Should never appear in search', 'good', 50000, 'draft')`,
      [seller, clothingLeafId],
    );

    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, description, condition, price_cents, status)
       values ('parent', $1, $2, 'Archived Stroller', 'Should never appear in search', 'good', 50000, 'archived')`,
      [seller, clothingLeafId],
    );

    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, description, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, 'Wooden Blocks', 'Educational toy', 'like_new', 15000, 'published', false, true)`,
      [seller, toysLeafId],
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("1. anonymous users only receive published listings", () => {
    it("anon sees the published listing", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ title: string }>(`select title from public.search_products($1)`, ["Stroller"]);
        expect(r.rows.map((x) => x.title)).toContain("Published Stroller");
      });
    });

    it("with no filters at all, anon only ever gets published rows", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ title: string }>(`select title from public.search_products(null)`);
        const titles = r.rows.map((x) => x.title);
        expect(titles).toContain("Published Stroller");
        expect(titles).toContain("Wooden Blocks");
        expect(titles).not.toContain("Draft Stroller");
        expect(titles).not.toContain("Archived Stroller");
      });
    });
  });

  describe("2. draft listings never appear in search", () => {
    it("searching by the draft's own exact title still returns nothing, for anon", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select title from public.search_products($1)`, ["Draft Stroller"]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("an unrelated authenticated user also never sees it", async () => {
      await asUser(db, buyer, async () => {
        const r = await db.query(`select title from public.search_products($1)`, ["Draft Stroller"]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("even the listing's own owner does not see it via search — this is the public browse path, not the seller dashboard", async () => {
      await asUser(db, seller, async () => {
        const r = await db.query(`select title from public.search_products($1)`, ["Draft Stroller"]);
        expect(r.rows).toHaveLength(0);
      });
    });
  });

  describe("3. archived listings never appear in search", () => {
    it("searching by the archived listing's own exact title returns nothing, for anon", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select title from public.search_products($1)`, ["Archived Stroller"]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("not even the owner sees it via search", async () => {
      await asUser(db, seller, async () => {
        const r = await db.query(`select title from public.search_products($1)`, ["Archived Stroller"]);
        expect(r.rows).toHaveLength(0);
      });
    });
  });

  describe("4. search cannot bypass RLS", () => {
    it("is not SECURITY DEFINER — confirms it runs as the calling role, not with elevated privilege", async () => {
      await db.query("reset role");
      const r = await db.query<{ prosecdef: boolean }>(
        `select prosecdef from pg_proc where proname = 'search_products'`,
      );
      expect(r.rows[0].prosecdef).toBe(false);
    });

    it("adversarial search terms (SQL/PostgREST-DSL special characters) never error and never leak drafts", async () => {
      await asAnon(db, async () => {
        for (const term of ["term,with,commas", "term(with)parens", "'; DROP TABLE products; --", "a%b_c"]) {
          const r = await db.query<{ title: string }>(`select title from public.search_products($1)`, [term]);
          expect(r.rows.every((row) => !row.title.includes("Draft") && !row.title.includes("Archived"))).toBe(true);
        }
      });
      const stillThere = await db.query(`select 1 from information_schema.tables where table_name = 'products'`);
      expect(stillThere.rows).toHaveLength(1);
    });
  });

  describe("5. category filtering cannot expose private listings", () => {
    it("filtering by the draft/archived listings' own category still excludes them", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ title: string }>(`select title from public.search_products(null, $1)`, [[clothingLeafId]]);
        const titles = r.rows.map((x) => x.title);
        expect(titles).toEqual(["Published Stroller"]);
      });
    });
  });

  describe("6. price filtering cannot expose private listings", () => {
    it("a price range matching the draft/archived listings' price still excludes them (only the published one at that price shows)", async () => {
      await asAnon(db, async () => {
        // Draft/Archived/Published Stroller are ALL price_cents=50000 —
        // this price filter would match all three if status weren't
        // still enforced underneath it.
        const r = await db.query<{ title: string }>(
          `select title from public.search_products(null, null, $1, $2)`,
          [40000, 60000],
        );
        expect(r.rows.map((x) => x.title)).toEqual(["Published Stroller"]);
      });
    });
  });

  describe("7. collection/delivery filters cannot expose private listings", () => {
    it("collection_only filter still excludes the draft (which also has collection_available=true by default)", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ title: string }>(
          `select title from public.search_products(null, null, null, null, null, true)`,
        );
        expect(r.rows.map((x) => x.title)).not.toContain("Draft Stroller");
      });
    });

    it("delivery_only filter still excludes the archived listing", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ title: string }>(
          `select title from public.search_products(null, null, null, null, null, false, true)`,
        );
        expect(r.rows.map((x) => x.title)).not.toContain("Archived Stroller");
      });
    });
  });

  describe("8. a malicious sort parameter cannot inject an arbitrary column", () => {
    it("an unrecognized sort_key falls back to newest instead of erroring or exposing unexpected ordering/columns", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ title: string }>(
          `select title from public.search_products(null, null, null, null, null, false, false, $1)`,
          ["price_cents); DROP TABLE products; --"],
        );
        // No error thrown reaching this line is itself part of the proof;
        // also confirm normal, safe results still come back.
        expect(r.rows.length).toBeGreaterThan(0);
      });
      const stillThere = await db.query(`select 1 from information_schema.tables where table_name = 'products'`);
      expect(stillThere.rows).toHaveLength(1);
    });

    it("price_asc and price_desc genuinely reorder results (proving sort is real, not silently ignored)", async () => {
      await asAnon(db, async () => {
        const asc = await db.query<{ price_cents: string }>(
          `select price_cents from public.search_products(null, null, null, null, null, false, false, 'price_asc')`,
        );
        const desc = await db.query<{ price_cents: string }>(
          `select price_cents from public.search_products(null, null, null, null, null, false, false, 'price_desc')`,
        );
        expect(asc.rows.map((r) => r.price_cents)).toEqual([...desc.rows.map((r) => r.price_cents)].reverse());
      });
    });
  });

  describe("9. pagination cannot bypass public visibility restrictions", () => {
    it("paging through every published result never surfaces the draft/archived rows, regardless of offset", async () => {
      await asAnon(db, async () => {
        const allTitles: string[] = [];
        for (let offset = 0; offset < 5; offset += 1) {
          const r = await db.query<{ title: string }>(
            `select title from public.search_products(null, null, null, null, null, false, false, 'newest', 1, $1)`,
            [offset],
          );
          allTitles.push(...r.rows.map((x) => x.title));
        }
        expect(allTitles).not.toContain("Draft Stroller");
        expect(allTitles).not.toContain("Archived Stroller");
      });
    });

    it("an absurd offset returns an empty page, not an error or wraparound", async () => {
      await asAnon(db, async () => {
        const r = await db.query(
          `select title from public.search_products(null, null, null, null, null, false, false, 'newest', 24, 999999)`,
        );
        expect(r.rows).toHaveLength(0);
      });
    });

    it("total_count reflects only publicly-visible rows, not the true table size including drafts/archived", async () => {
      await asAnon(db, async () => {
        const r = await db.query<{ total_count: string }>(`select total_count from public.search_products(null) limit 1`);
        // 2 published fixtures exist (Published Stroller, Wooden Blocks); 2 more (draft, archived) must not be counted.
        expect(Number(r.rows[0].total_count)).toBe(2);
      });
    });
  });

  describe("10. public listing responses do not expose private seller information", () => {
    it("the function's return columns never include any seller/owner identifier or contact field", async () => {
      await db.query("reset role");
      const r = await db.query<{ column_name: string }>(
        `select unnest(proargnames) as column_name from pg_proc where proname = 'search_products'`,
      );
      // proargnames includes both IN params and OUT/return columns for a
      // function declared with a RETURNS TABLE — check the full set never
      // contains anything seller-identifying.
      const names = r.rows.map((row) => row.column_name);
      for (const forbidden of ["seller_profile_id", "business_id", "seller_id", "owner_id", "email", "phone"]) {
        expect(names).not.toContain(forbidden);
      }
    });

    it("an actual search response contains only the documented public-safe columns", async () => {
      await asAnon(db, async () => {
        const r = await db.query<Record<string, unknown>>(`select * from public.search_products($1) limit 1`, ["Stroller"]);
        const columns = Object.keys(r.rows[0]);
        expect(columns.sort()).toEqual(
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
            "total_count",
          ].sort(),
        );
      });
    });
  });
});
