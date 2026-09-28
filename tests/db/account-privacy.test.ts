import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 13C: the personal account's read-side privacy, exercised against
 * the real migration SQL. The write-side (another user can't modify your
 * profile/location/verification) is already covered in rls.test.ts,
 * location-ownership.test.ts, and verification.test.ts; this fills the
 * remaining read-isolation gaps for the raw profiles/locations tables and
 * pins exactly what the public profile view exposes.
 */
describe("personal account privacy (Phase 13C)", () => {
  let db: PGlite;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    alice = await makeUser(db, "Privacy Alice");
    bob = await makeUser(db, "Privacy Bob");

    const loc = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude, suburb, city) values ($1, -33.9, 18.4, 'Gardens', 'Cape Town') returning id`,
      [alice],
    );
    await db.query(`update public.profiles set phone = '0821234567', location_id = $2 where id = $1`, [alice, loc.rows[0].id]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("C. a user can read their own raw profile (including phone)", async () => {
    const r = await asUser(db, alice, () => db.query<{ phone: string }>(`select phone from public.profiles where id = $1`, [alice]));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].phone).toBe("0821234567");
  });

  it("C. another user cannot read someone else's raw profile — phone and location_id stay private", async () => {
    const r = await asUser(db, bob, () => db.query(`select phone, location_id from public.profiles where id = $1`, [alice]));
    expect(r.rows).toHaveLength(0);
  });

  it("I. a user can read their own saved location row", async () => {
    const r = await asUser(db, alice, () => db.query(`select suburb, city from public.locations where created_by = $1`, [alice]));
    expect(r.rows).toHaveLength(1);
  });

  it("J. another user cannot read someone else's saved location — coordinates included", async () => {
    const r = await asUser(db, bob, () => db.query(`select latitude, longitude, suburb from public.locations where created_by = $1`, [alice]));
    expect(r.rows).toHaveLength(0);
  });

  it("K. an anonymous visitor cannot read any raw profile or location row", async () => {
    const profiles = await asAnon(db, () => db.query(`select id from public.profiles`));
    const locations = await asAnon(db, () => db.query(`select id from public.locations`));
    expect(profiles.rows).toHaveLength(0);
    expect(locations.rows).toHaveLength(0);
  });

  it("K. the public profile view exposes no phone, location, or identity-document columns — only the approved public fields", async () => {
    await db.query("reset role");
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles_public'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const forbidden of ["phone", "location_id", "id_number", "document_storage_path", "notes", "email"]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toContain("full_name");
    expect(names).toContain("identity_verification");
  });

  it("K. the public location view exposes only suburb/city/province, never coordinates or a formatted address", async () => {
    await db.query("reset role");
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'product_locations_public'`,
    );
    const names = cols.rows.map((c) => c.column_name).sort();
    expect(names).toEqual(["city", "product_id", "province", "suburb"]);
  });
});
