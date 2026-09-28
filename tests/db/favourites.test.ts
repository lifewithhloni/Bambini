import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 14A: product_favourites exercised against the real migration SQL.
 * The table and its owner-only policy pre-date this phase (foundation
 * schema); these tests pin the properties the saved-items feature relies
 * on without changing any of them: owner-only read/write, no duplicates
 * (composite primary key), no favouriting a nonexistent product, no
 * writing another user's row, and that a favourite is history that
 * survives the listing becoming unavailable.
 */
describe("product_favourites (Phase 14A)", () => {
  let db: PGlite;
  let alice: string;
  let bob: string;
  let seller: string;
  let categoryId: string;

  async function makeProduct(title: string, status: "draft" | "published" | "archived" | "sold" = "published"): Promise<string> {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
       values ('parent', $1, $2, $3, 'good', 5000, $4) returning id`,
      [seller, categoryId, title, status],
    );
    return r.rows[0].id;
  }

  const save = (user: string, productId: string, asProfile = user) =>
    asUser(db, user, () => db.query(`insert into public.product_favourites (profile_id, product_id) values ($1, $2)`, [asProfile, productId]));

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    alice = await makeUser(db, "Fav Alice");
    bob = await makeUser(db, "Fav Bob");
    seller = await makeUser(db, "Fav Seller");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("A. an authenticated user can save a listing", async () => {
    const p = await makeProduct("Save Me A");
    const r = await save(alice, p);
    expect(r.affectedRows).toBe(1);
  });

  it("A. and can read their own saved listings", async () => {
    const p = await makeProduct("Save Me A2");
    await save(alice, p);
    const r = await asUser(db, alice, () => db.query(`select product_id from public.product_favourites where product_id = $1`, [p]));
    expect(r.rows).toHaveLength(1);
  });

  it("B. a user can unsave their own favourite", async () => {
    const p = await makeProduct("Unsave Me B");
    await save(alice, p);
    const r = await asUser(db, alice, () => db.query(`delete from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]));
    expect(r.affectedRows).toBe(1);
    const after = await asUser(db, alice, () => db.query(`select 1 from public.product_favourites where product_id = $1`, [p]));
    expect(after.rows).toHaveLength(0);
  });

  it("C. saving the same listing twice cannot create a duplicate row — the composite primary key rejects a plain insert", async () => {
    const p = await makeProduct("Dup C");
    await save(alice, p);
    await expect(save(alice, p)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("C. and INSERT … ON CONFLICT DO NOTHING (what the app's upsert uses) is a clean no-op that leaves exactly one row", async () => {
    const p = await makeProduct("Dup C2");
    await save(alice, p);
    await asUser(db, alice, () =>
      db.query(`insert into public.product_favourites (profile_id, product_id) values ($1, $2) on conflict (profile_id, product_id) do nothing`, [alice, p]),
    );
    const r = await asUser(db, alice, () => db.query(`select 1 from public.product_favourites where product_id = $1`, [p]));
    expect(r.rows).toHaveLength(1);
  });

  it("D. unsaving something that isn't saved is safe — zero rows, no error", async () => {
    const p = await makeProduct("Never Saved D");
    const r = await asUser(db, alice, () => db.query(`delete from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]));
    expect(r.affectedRows).toBe(0);
  });

  it("E. an anonymous visitor cannot create a favourite", async () => {
    const p = await makeProduct("Anon E");
    await expect(asAnon(db, () => db.query(`insert into public.product_favourites (profile_id, product_id) values ($1, $2)`, [alice, p]))).rejects.toThrow();
  });

  it("E. and cannot read anyone's favourites", async () => {
    const p = await makeProduct("Anon E2");
    await save(alice, p);
    const r = await asAnon(db, () => db.query(`select * from public.product_favourites`));
    expect(r.rows).toHaveLength(0);
  });

  it("F. another user cannot read someone else's favourites", async () => {
    const p = await makeProduct("Private F");
    await save(alice, p);
    const r = await asUser(db, bob, () => db.query(`select * from public.product_favourites where profile_id = $1`, [alice]));
    expect(r.rows).toHaveLength(0);
  });

  it("G. another user cannot delete someone else's favourite — it matches zero rows and the row survives", async () => {
    const p = await makeProduct("NoDelete G");
    await save(alice, p);
    const r = await asUser(db, bob, () => db.query(`delete from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]));
    expect(r.affectedRows).toBe(0);
    await db.query("reset role");
    const check = await db.query(`select 1 from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]);
    expect(check.rows).toHaveLength(1);
  });

  it("G. another user cannot modify someone else's favourite either", async () => {
    const p = await makeProduct("NoUpdate G");
    await save(alice, p);
    const r = await asUser(db, bob, () =>
      db.query(`update public.product_favourites set created_at = now() - interval '1 year' where profile_id = $1 and product_id = $2`, [alice, p]),
    );
    expect(r.affectedRows).toBe(0);
  });

  it("H. a nonexistent product cannot be favourited", async () => {
    await expect(save(alice, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/foreign key|violates/i);
  });

  it("N. a client cannot create a favourite owned by another user — RLS WITH CHECK rejects a foreign profile_id", async () => {
    const p = await makeProduct("Spoof N");
    await expect(save(bob, p, alice)).rejects.toThrow(/row-level security|violates/i);
    await db.query("reset role");
    const check = await db.query(`select 1 from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]);
    expect(check.rows).toHaveLength(0);
  });

  it("privacy: a listing's own seller cannot see who saved it — favourites are readable by their owner only", async () => {
    const p = await makeProduct("Seller Blind");
    await save(alice, p);
    await save(bob, p);
    const r = await asUser(db, seller, () => db.query(`select * from public.product_favourites where product_id = $1`, [p]));
    expect(r.rows).toHaveLength(0);
  });

  it("J. a favourite survives its listing being sold — it's the user's history, not tied to availability", async () => {
    const p = await makeProduct("Will Sell J");
    await save(alice, p);
    await db.query(`update public.products set status = 'sold' where id = $1`, [p]);
    const r = await asUser(db, alice, () => db.query(`select 1 from public.product_favourites where product_id = $1`, [p]));
    expect(r.rows).toHaveLength(1);
  });

  it("K. a favourite survives its listing being archived", async () => {
    const p = await makeProduct("Will Archive K");
    await save(alice, p);
    await db.query(`update public.products set status = 'archived' where id = $1`, [p]);
    const r = await asUser(db, alice, () => db.query(`select 1 from public.product_favourites where product_id = $1`, [p]));
    expect(r.rows).toHaveLength(1);
  });

  it("L. deleting a product cascades cleanly — no dangling favourite is left pointing at a missing listing", async () => {
    const p = await makeProduct("Will Delete L", "draft");
    await db.query(`insert into public.product_favourites (profile_id, product_id) values ($1, $2)`, [alice, p]);
    await db.query(`delete from public.products where id = $1`, [p]);
    const r = await db.query(`select 1 from public.product_favourites where product_id = $1`, [p]);
    expect(r.rows).toHaveLength(0);
  });

  it("saving does not create any order, transaction event, or seller-visible record", async () => {
    const before = await db.query<{ n: number }>(`select (select count(*) from public.transaction_events)::int + (select count(*) from public.orders)::int as n`);
    const p = await makeProduct("No Side Effects S");
    await save(alice, p);
    await db.query("reset role");
    const after = await db.query<{ n: number }>(`select (select count(*) from public.transaction_events)::int + (select count(*) from public.orders)::int as n`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // Phase 14A hardening (20261011090000_favourites_require_published_on_write.sql):
  // the database itself — not just saveListing() — refuses to CREATE a
  // favourite for anything that isn't published right now, while existing
  // favourites remain readable/deletable after their listing changes state.
  describe("a NEW favourite requires a currently published listing (database-enforced)", () => {
    it("1. an authenticated user can favourite a published listing", async () => {
      const p = await makeProduct("Published OK");
      expect((await save(alice, p)).affectedRows).toBe(1);
    });

    it("2. direct INSERT for a DRAFT listing is rejected", async () => {
      const p = await makeProduct("Draft Reject", "draft");
      await expect(save(alice, p)).rejects.toThrow(/row-level security/i);
    });

    it("3. direct INSERT for an ARCHIVED listing is rejected", async () => {
      const p = await makeProduct("Archived Reject", "archived");
      await expect(save(alice, p)).rejects.toThrow(/row-level security/i);
    });

    it("4. direct INSERT for a SOLD listing is rejected", async () => {
      const p = await makeProduct("Sold Reject", "sold");
      await expect(save(alice, p)).rejects.toThrow(/row-level security/i);
    });

    it("the listing's own seller can't favourite their own draft either — the rule is about the product, not the caller", async () => {
      const p = await makeProduct("Own Draft", "draft");
      await expect(save(seller, p)).rejects.toThrow(/row-level security/i);
    });

    it("a nonexistent product is still rejected", async () => {
      await expect(save(alice, "00000000-0000-4000-8000-000000000001")).rejects.toThrow(/row-level security|foreign key|violates/i);
    });

    it("an UPDATE cannot re-point an existing favourite at a draft/archived/sold listing (that would bypass the insert rule)", async () => {
      const published = await makeProduct("Repoint Source");
      const draft = await makeProduct("Repoint Target", "draft");
      await save(alice, published);
      await expect(
        asUser(db, alice, () => db.query(`update public.product_favourites set product_id = $1 where profile_id = $2 and product_id = $3`, [draft, alice, published])),
      ).rejects.toThrow(/row-level security/i);
      await db.query("reset role");
      const check = await db.query(`select product_id from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, published]);
      expect(check.rows).toHaveLength(1);
    });

    it("5. an existing favourite survives published -> sold, and is still readable by its owner", async () => {
      const p = await makeProduct("Survive Sold");
      await save(alice, p);
      await db.query(`update public.products set status = 'sold' where id = $1`, [p]);
      const r = await asUser(db, alice, () => db.query(`select 1 from public.product_favourites where product_id = $1`, [p]));
      expect(r.rows).toHaveLength(1);
    });

    it("6. an existing favourite survives published -> archived, and is still readable by its owner", async () => {
      const p = await makeProduct("Survive Archived");
      await save(alice, p);
      await db.query(`update public.products set status = 'archived' where id = $1`, [p]);
      const r = await asUser(db, alice, () => db.query(`select 1 from public.product_favourites where product_id = $1`, [p]));
      expect(r.rows).toHaveLength(1);
    });

    it("7. the owner can still delete/unsave a favourite after the product became sold", async () => {
      const p = await makeProduct("Unsave After Sold");
      await save(alice, p);
      await db.query(`update public.products set status = 'sold' where id = $1`, [p]);
      const r = await asUser(db, alice, () => db.query(`delete from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]));
      expect(r.affectedRows).toBe(1);
    });

    it("8. the owner can still delete/unsave a favourite after the product became archived", async () => {
      const p = await makeProduct("Unsave After Archived");
      await save(alice, p);
      await db.query(`update public.products set status = 'archived' where id = $1`, [p]);
      const r = await asUser(db, alice, () => db.query(`delete from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]));
      expect(r.affectedRows).toBe(1);
    });

    it("9. another user still cannot read someone else's favourite, even after the listing changes state", async () => {
      const p = await makeProduct("Private After Sold");
      await save(alice, p);
      await db.query(`update public.products set status = 'sold' where id = $1`, [p]);
      const r = await asUser(db, bob, () => db.query(`select * from public.product_favourites where profile_id = $1`, [alice]));
      expect(r.rows).toHaveLength(0);
    });

    it("10. another user still cannot delete someone else's favourite, even after the listing changes state", async () => {
      const p = await makeProduct("NoDelete After Archived");
      await save(alice, p);
      await db.query(`update public.products set status = 'archived' where id = $1`, [p]);
      const r = await asUser(db, bob, () => db.query(`delete from public.product_favourites where profile_id = $1 and product_id = $2`, [alice, p]));
      expect(r.affectedRows).toBe(0);
    });

    it("11. an anonymous user still cannot create a favourite, even for a published listing", async () => {
      const p = await makeProduct("Anon Published");
      await expect(asAnon(db, () => db.query(`insert into public.product_favourites (profile_id, product_id) values ($1, $2)`, [alice, p]))).rejects.toThrow();
    });

    it("policy shape: SELECT and DELETE never consult the product, so history stays readable and clearable; INSERT and UPDATE both require it", async () => {
      await db.query("reset role");
      const r = await db.query<{ cmd: string; qual: string | null; with_check: string | null }>(
        `select cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'product_favourites'`,
      );
      const byCmd = Object.fromEntries(r.rows.map((row) => [row.cmd, row]));
      expect(Object.keys(byCmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      expect(byCmd.SELECT.qual).not.toMatch(/products|published/);
      expect(byCmd.DELETE.qual).not.toMatch(/products|published/);
      expect(byCmd.INSERT.with_check).toMatch(/products/);
      expect(byCmd.INSERT.with_check).toMatch(/published/);
      expect(byCmd.UPDATE.with_check).toMatch(/products/);
      expect(byCmd.UPDATE.with_check).toMatch(/published/);
    });
  });
});
