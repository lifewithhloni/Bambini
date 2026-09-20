import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 3B security review follow-up. Two things this file proves
 * against a real Postgres engine, not just by reading policy text:
 *
 * 1. profiles.location_id ownership — the invariant a user's saved
 *    location must represent a location they're actually authorized to
 *    use as their own (see 20260924090000_harden_profile_location_ownership.sql
 *    and DECISIONS.md). The four cases the review asked for: (a) a
 *    user's own location, (b) another user's location, (c) a
 *    nonexistent location, (d) a location they didn't create — (b) and
 *    (d) are the same case here (locations have exactly one creator),
 *    kept as separate `it`s anyway since the review named them
 *    separately.
 * 2. General location-mutation regression coverage: create/update own,
 *    cannot modify another's, cannot attach another's (to a profile or
 *    a listing), cannot reference a fabricated id, and deleting a
 *    location cleanly nulls out every dependent reference rather than
 *    leaving a dangling one or corrupting an unrelated user's location.
 */
describe("location ownership", () => {
  let db: PGlite;
  let alice: string;
  let bob: string;
  let aliceLocId: string;
  let bobLocId: string;
  let categoryId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    alice = await makeUser(db, "Ownership Alice");
    bob = await makeUser(db, "Ownership Bob");

    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;

    const aliceLoc = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, -33.9, 18.4, 'Gardens', 'Cape Town') returning id`,
      [alice],
    );
    aliceLocId = aliceLoc.rows[0].id;

    const bobLoc = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, -33.95, 18.45, 'Woodstock', 'Cape Town') returning id`,
      [bob],
    );
    bobLocId = bobLoc.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("profiles.location_id ownership — the four required cases", () => {
    it("(a) a user CAN set their profile's location_id to their own location", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`update public.profiles set location_id = $1 where id = $2`, [aliceLocId, alice]),
      );
      expect(r.affectedRows).toBe(1);
    });

    it("(b) a user CANNOT set their profile's location_id to another user's location", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(`update public.profiles set location_id = $1 where id = $2`, [aliceLocId, bob]),
        ).rejects.toThrow(/row-level security/i);
      });
      await db.query("reset role");
      const check = await db.query<{ location_id: string | null }>(`select location_id from public.profiles where id = $1`, [bob]);
      expect(check.rows[0].location_id).not.toBe(aliceLocId);
    });

    it("(c) a user CANNOT set their profile's location_id to a nonexistent location", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(`update public.profiles set location_id = $1 where id = $2`, [
            "00000000-0000-4000-8000-000000000000",
            alice,
          ]),
        ).rejects.toThrow(); // FK violation — enforced at the schema level, independent of RLS
      });
    });

    it("(d) a user CANNOT set their profile's location_id to a location they did not create, even freshly inserted by someone else", async () => {
      const carol = await makeUser(db, "Ownership Carol");
      const carolLoc = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude) values ($1, -34.0, 18.5) returning id`,
        [carol],
      );
      await asUser(db, alice, async () => {
        await expect(
          db.query(`update public.profiles set location_id = $1 where id = $2`, [carolLoc.rows[0].id, alice]),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("also enforced on INSERT (profiles_insert_own), not just UPDATE", async () => {
      // profiles rows are normally created by the handle_new_user()
      // trigger, but the column-level grant does permit a direct
      // INSERT — the same ownership boundary must hold there too, not
      // just on UPDATE.
      await db.query("reset role");
      const dave = await makeUser(db, "Ownership Dave"); // trigger already created dave's row
      await db.query(`delete from public.profiles where id = $1`, [dave]); // isolate INSERT behavior for this test

      await asUser(db, dave, async () => {
        await expect(
          db.query(
            `insert into public.profiles (id, full_name, location_id) values ($1, 'Dave Forged', $2)`,
            [dave, aliceLocId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("an admin CAN set any profile's location_id, including to another user's location (support/moderation exemption)", async () => {
      const admin = await makeUser(db, "Ownership Admin");
      await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

      const r = await asUser(db, admin, () =>
        db.query(`update public.profiles set location_id = $1 where id = $2`, [bobLocId, alice]),
      );
      expect(r.affectedRows).toBe(1);

      // restore alice's own location so later tests in this file aren't affected
      await db.query("reset role");
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [aliceLocId, alice]);
    });
  });

  describe("location mutation regression coverage", () => {
    it("user A can create their own location", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`insert into public.locations (created_by, latitude, longitude) values ($1, -33.8, 18.3) returning id`, [alice]),
      );
      expect(r.rows).toHaveLength(1);
    });

    it("user A can update their own location", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`update public.locations set suburb = 'Updated Suburb' where id = $1`, [aliceLocId]),
      );
      expect(r.affectedRows).toBe(1);
      // restore
      await db.query("reset role");
      await db.query(`update public.locations set suburb = 'Gardens' where id = $1`, [aliceLocId]);
    });

    it("user A cannot modify user B's location", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`update public.locations set suburb = 'Hijacked' where id = $1`, [bobLocId]),
      );
      expect(r.affectedRows).toBe(0);
      await db.query("reset role");
      const check = await db.query<{ suburb: string }>(`select suburb from public.locations where id = $1`, [bobLocId]);
      expect(check.rows[0].suburb).toBe("Woodstock");
    });

    it("user A cannot attach user B's location to their profile", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(`update public.profiles set location_id = $1 where id = $2`, [bobLocId, alice]),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("user A cannot attach user B's location to one of their listings", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
             values ('parent', $1, $2, 'Alice Item Forged Location', 'good', 1000, $3, 'draft')`,
            [alice, categoryId, bobLocId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("user A cannot reference a fabricated (nonexistent) location id on a listing", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
             values ('parent', $1, $2, 'Alice Item Fake Location', 'good', 1000, $3, 'draft')`,
            [alice, categoryId, "00000000-0000-4000-8000-000000000000"],
          ),
        ).rejects.toThrow(); // FK violation
      });
    });

    it("deleting a location cleanly nulls the owner's own dependent references, without erroring", async () => {
      const eve = await makeUser(db, "Ownership Eve");
      const eveLoc = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude) values ($1, -33.7, 18.2) returning id`,
        [eve],
      );
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [eveLoc.rows[0].id, eve]);
      const eveProduct = await db.query<{ id: string }>(
        `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
         values ('parent', $1, $2, 'Eve Item', 'good', 1000, $3, 'draft') returning id`,
        [eve, categoryId, eveLoc.rows[0].id],
      );

      await asUser(db, eve, () => db.query(`delete from public.locations where id = $1`, [eveLoc.rows[0].id]));

      await db.query("reset role");
      const profile = await db.query<{ location_id: string | null }>(`select location_id from public.profiles where id = $1`, [eve]);
      expect(profile.rows[0].location_id).toBeNull();
      const product = await db.query<{ pickup_location_id: string | null }>(
        `select pickup_location_id from public.products where id = $1`,
        [eveProduct.rows[0].id],
      );
      expect(product.rows[0].pickup_location_id).toBeNull();
    });

    it("deleting user A's location does not touch user B's unrelated location or profile", async () => {
      const frank = await makeUser(db, "Ownership Frank");
      const frankLoc = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude, suburb) values ($1, -33.6, 18.1, 'FrankSuburb') returning id`,
        [frank],
      );
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [frankLoc.rows[0].id, frank]);

      const grace = await makeUser(db, "Ownership Grace");
      const graceLoc = await db.query<{ id: string }>(
        `insert into public.locations (created_by, latitude, longitude, suburb) values ($1, -33.5, 18.0, 'GraceSuburb') returning id`,
        [grace],
      );
      await db.query(`update public.profiles set location_id = $1 where id = $2`, [graceLoc.rows[0].id, grace]);

      await asUser(db, frank, () => db.query(`delete from public.locations where id = $1`, [frankLoc.rows[0].id]));

      await db.query("reset role");
      const graceProfile = await db.query<{ location_id: string | null }>(`select location_id from public.profiles where id = $1`, [grace]);
      expect(graceProfile.rows[0].location_id).toBe(graceLoc.rows[0].id);
      const graceLocation = await db.query<{ suburb: string }>(`select suburb from public.locations where id = $1`, [graceLoc.rows[0].id]);
      expect(graceLocation.rows[0].suburb).toBe("GraceSuburb");
    });
  });

  describe("SECURITY DEFINER search_path safety", () => {
    it("anon has no CREATE privilege on the public schema — an attacker cannot plant a shadowing object there", async () => {
      await db.query("reset role");
      const r = await db.query<{ can_create: boolean }>(`select has_schema_privilege('anon', 'public', 'create') as can_create`);
      expect(r.rows[0].can_create).toBe(false);
    });

    it("authenticated has no CREATE privilege on the public schema either", async () => {
      await db.query("reset role");
      const r = await db.query<{ can_create: boolean }>(
        `select has_schema_privilege('authenticated', 'public', 'create') as can_create`,
      );
      expect(r.rows[0].can_create).toBe(false);
    });

    it("authenticated is concretely denied when attempting to create a function in public (not just theoretically, per the grant above)", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(`create function public.st_distance(a geography, b geography) returns double precision language sql as $$ select 0.0 $$`),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("search_nearby_products() is SET search_path = public — not unset/empty, not attacker-influenceable", async () => {
      await db.query("reset role");
      const r = await db.query<{ proconfig: string[] | null }>(
        `select proconfig from pg_proc where proname = 'search_nearby_products'`,
      );
      expect(r.rows[0].proconfig).toContain("search_path=public");
    });

    it("search_nearby_products()'s EXECUTE grant never includes PUBLIC — only the roles a Supabase client request can ever assume", async () => {
      await db.query("reset role");
      const r = await db.query<{ grantee: string; privilege_type: string }>(`
        select grantee, privilege_type
        from information_schema.routine_privileges
        where routine_name = 'search_nearby_products' and privilege_type = 'EXECUTE'
      `);
      const grantees = r.rows.map((row) => row.grantee).sort();
      // postgres (owner) and service_role (server-side only, via the
      // harness's own default-privileges grant — mirrors what Supabase
      // provisions) are expected; PUBLIC is not — CREATE FUNCTION grants
      // EXECUTE to PUBLIC by default unless explicitly revoked, which is
      // exactly the gap this test guards against regressing.
      expect(grantees).not.toContain("PUBLIC");
      expect(grantees).toEqual(expect.arrayContaining(["anon", "authenticated"]));
    });

    it("product_locations_public's SELECT grant never includes PUBLIC either — views get no implicit default grant, confirmed rather than assumed", async () => {
      await db.query("reset role");
      const r = await db.query<{ grantee: string }>(`
        select grantee
        from information_schema.table_privileges
        where table_name = 'product_locations_public' and privilege_type = 'SELECT'
      `);
      const grantees = r.rows.map((row) => row.grantee).sort();
      expect(grantees).not.toContain("PUBLIC");
      expect(grantees).toEqual(expect.arrayContaining(["anon", "authenticated"]));
    });
  });
});
