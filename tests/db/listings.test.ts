import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 2A: listing (products) ownership, lifecycle visibility, business
 * membership authorization, and product-images storage policies —
 * exercised against the real migration SQL and real RLS, the same
 * method as tests/db/rls.test.ts. See that file's header comment for
 * the affectedRows-vs-throw methodology note, which applies here too.
 */
describe("listings", () => {
  let db: PGlite;
  let alice: string;
  let bob: string;
  let dave: string;
  let admin: string;
  let categoryId: string;
  let aliceBusinessId: string;
  let bobBusinessId: string;
  let aliceDraftId: string;
  let alicePublishedId: string;
  let aliceArchivedId: string;
  let aliceBusinessListingId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    alice = await makeUser(db, "Alice Seller");
    bob = await makeUser(db, "Bob Seller");
    dave = await makeUser(db, "Dave BusinessMember");
    admin = await makeUser(db, "Admin Person");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;

    const aliceBiz = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug) values ($1, 'Alice Shop', 'alice-shop') returning id`,
      [alice],
    );
    aliceBusinessId = aliceBiz.rows[0].id;
    await db.query(`insert into public.business_members (business_id, profile_id, role) values ($1, $2, 'staff')`, [
      aliceBusinessId,
      dave,
    ]);

    const bobBiz = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug) values ($1, 'Bob Shop', 'bob-shop') returning id`,
      [bob],
    );
    bobBusinessId = bobBiz.rows[0].id;

    const draft = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
       values ('parent', $1, $2, 'Alice Draft', 'good', 1000, 'draft') returning id`,
      [alice, categoryId],
    );
    aliceDraftId = draft.rows[0].id;

    const published = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
       values ('parent', $1, $2, 'Alice Published', 'good', 2000, 'published') returning id`,
      [alice, categoryId],
    );
    alicePublishedId = published.rows[0].id;

    const archived = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
       values ('parent', $1, $2, 'Alice Archived', 'good', 3000, 'archived') returning id`,
      [alice, categoryId],
    );
    aliceArchivedId = archived.rows[0].id;

    const bizListing = await db.query<{ id: string }>(
      `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status)
       values ('business', $1, $2, 'Alice Shop Item', 'good', 4000, 'published') returning id`,
      [aliceBusinessId, categoryId],
    );
    aliceBusinessListingId = bizListing.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("public visibility of the listing lifecycle", () => {
    it("anon can read a published listing", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select id from public.products where id = $1`, [alicePublishedId]);
        expect(r.rows).toHaveLength(1);
      });
    });

    it("anon cannot read a draft listing", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select id from public.products where id = $1`, [aliceDraftId]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("anon cannot read an archived listing", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select id from public.products where id = $1`, [aliceArchivedId]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("an unrelated signed-in user also cannot read another seller's draft or archived listing", async () => {
      await asUser(db, bob, async () => {
        const draftResult = await db.query(`select id from public.products where id = $1`, [aliceDraftId]);
        expect(draftResult.rows).toHaveLength(0);
        const archivedResult = await db.query(`select id from public.products where id = $1`, [aliceArchivedId]);
        expect(archivedResult.rows).toHaveLength(0);
      });
    });

    it("the owner can read her own draft and archived listings", async () => {
      await asUser(db, alice, async () => {
        const draftResult = await db.query(`select id from public.products where id = $1`, [aliceDraftId]);
        expect(draftResult.rows).toHaveLength(1);
        const archivedResult = await db.query(`select id from public.products where id = $1`, [aliceArchivedId]);
        expect(archivedResult.rows).toHaveLength(1);
      });
    });
  });

  describe("seller A cannot modify or delete seller B's listing", () => {
    it("Bob cannot UPDATE Alice's published listing", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`update public.products set title = 'Hijacked' where id = $1`, [alicePublishedId]),
      );
      expect(r.affectedRows).toBe(0);
      const check = await db.query<{ title: string }>(`select title from public.products where id = $1`, [alicePublishedId]);
      expect(check.rows[0].title).toBe("Alice Published");
    });

    it("Bob cannot DELETE Alice's listing", async () => {
      const r = await asUser(db, bob, () => db.query(`delete from public.products where id = $1`, [aliceDraftId]));
      expect(r.affectedRows).toBe(0);
      const check = await db.query(`select id from public.products where id = $1`, [aliceDraftId]);
      expect(check.rows).toHaveLength(1);
    });

    it("Alice can update and delete her own listing (sanity check)", async () => {
      const created = await asUser(db, alice, () =>
        db.query<{ id: string }>(
          `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
           values ('parent', $1, $2, 'Temp', 'good', 500, 'draft') returning id`,
          [alice, categoryId],
        ),
      );
      const tempId = created.rows[0].id;

      const updateResult = await asUser(db, alice, () =>
        db.query(`update public.products set title = 'Temp Renamed' where id = $1`, [tempId]),
      );
      expect(updateResult.affectedRows).toBe(1);

      const deleteResult = await asUser(db, alice, () => db.query(`delete from public.products where id = $1`, [tempId]));
      expect(deleteResult.affectedRows).toBe(1);
    });
  });

  describe("ownership cannot be assigned or reassigned", () => {
    it("Bob cannot INSERT a listing assigning Alice as the owner", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
             values ('parent', $1, $2, 'Forged', 'good', 100, 'draft')`,
            [alice, categoryId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    // Unlike the "not owned at all" cases above (which silently match 0
    // rows via the USING clause), these rows DO match USING — Alice/Dave
    // own them — so Postgres evaluates WITH CHECK against the proposed
    // new values, and a WITH CHECK failure throws ("new row violates
    // row-level security policy") rather than silently skipping the
    // row. Confirmed against the real engine, not assumed.
    it("Alice cannot UPDATE her own listing to reassign it to Bob", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(`update public.products set seller_profile_id = $1 where id = $2`, [bob, alicePublishedId]),
        ).rejects.toThrow(/row-level security/i);
      });
      const check = await db.query<{ seller_profile_id: string }>(
        `select seller_profile_id from public.products where id = $1`,
        [alicePublishedId],
      );
      expect(check.rows[0].seller_profile_id).toBe(alice);
    });

    it("Alice cannot UPDATE her own listing to move it to Bob's business", async () => {
      await asUser(db, alice, async () => {
        await expect(
          db.query(
            `update public.products set seller_type = 'business', business_id = $1, seller_profile_id = null where id = $2`,
            [bobBusinessId, alicePublishedId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
      const check = await db.query<{ seller_type: string; business_id: string | null }>(
        `select seller_type, business_id from public.products where id = $1`,
        [alicePublishedId],
      );
      expect(check.rows[0]).toEqual({ seller_type: "parent", business_id: null });
    });

    it("cannot manipulate business_id on a business listing to move it to an unrelated business", async () => {
      await asUser(db, dave, async () => {
        await expect(
          db.query(`update public.products set business_id = $1 where id = $2`, [bobBusinessId, aliceBusinessListingId]),
        ).rejects.toThrow(/row-level security/i);
      });
      const check = await db.query<{ business_id: string }>(`select business_id from public.products where id = $1`, [
        aliceBusinessListingId,
      ]);
      expect(check.rows[0].business_id).toBe(aliceBusinessId);
    });
  });

  describe("business membership authorization", () => {
    it("a business member (not the owner) can read and update the business's listing", async () => {
      const selectResult = await asUser(db, dave, () =>
        db.query(`select id from public.products where id = $1`, [aliceBusinessListingId]),
      );
      expect(selectResult.rows).toHaveLength(1);

      const updateResult = await asUser(db, dave, () =>
        db.query(`update public.products set title = 'Updated by staff' where id = $1`, [aliceBusinessListingId]),
      );
      expect(updateResult.affectedRows).toBe(1);
    });

    it("an unrelated user cannot update a business's listing", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`update public.products set title = 'Hijacked' where id = $1`, [aliceBusinessListingId]),
      );
      expect(r.affectedRows).toBe(0);
    });

    it("an unrelated user cannot read the business's raw row (only businesses_public, and only once verified)", async () => {
      const r = await asUser(db, bob, () => db.query(`select id from public.businesses where id = $1`, [aliceBusinessId]));
      expect(r.rows).toHaveLength(0);
    });

    it("an unverified business does not appear in businesses_public for anyone", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select id from public.businesses_public where id = $1`, [aliceBusinessId]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("once verified (admin-only action), the business appears in businesses_public", async () => {
      await db.query("reset role");
      await db.query(`update public.businesses set verification_status = 'verified' where id = $1`, [aliceBusinessId]);
      await asAnon(db, async () => {
        const r = await db.query(`select id from public.businesses_public where id = $1`, [aliceBusinessId]);
        expect(r.rows).toHaveLength(1);
      });
    });

    it("an unrelated user cannot see the business's member list", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`select profile_id from public.business_members where business_id = $1`, [aliceBusinessId]),
      );
      expect(r.rows).toHaveLength(0);
    });

    it("a member can see the business's own member list", async () => {
      const r = await asUser(db, dave, () =>
        db.query(`select profile_id from public.business_members where business_id = $1`, [aliceBusinessId]),
      );
      expect(r.rows.length).toBeGreaterThan(0);
    });
  });

  describe("admin access follows the existing authorization architecture", () => {
    it("admin can update any listing regardless of owner", async () => {
      const r = await asUser(db, admin, () =>
        db.query(`update public.products set title = 'Moderated' where id = $1`, [alicePublishedId]),
      );
      expect(r.affectedRows).toBe(1);
    });

    it("admin can read a draft/archived listing owned by someone else", async () => {
      const draftResult = await asUser(db, admin, () => db.query(`select id from public.products where id = $1`, [aliceDraftId]));
      expect(draftResult.rows).toHaveLength(1);
      const archivedResult = await asUser(db, admin, () =>
        db.query(`select id from public.products where id = $1`, [aliceArchivedId]),
      );
      expect(archivedResult.rows).toHaveLength(1);
    });

    it("admin can delete any listing", async () => {
      const created = await db.query<{ id: string }>(
        `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
         values ('parent', $1, $2, 'Admin Delete Target', 'good', 500, 'draft') returning id`,
        [bob, categoryId],
      );
      const r = await asUser(db, admin, () => db.query(`delete from public.products where id = $1`, [created.rows[0].id]));
      expect(r.affectedRows).toBe(1);
    });
  });

  describe("product-images storage policies", () => {
    it("a seller can upload into their own listing's storage folder", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('product-images', $1, $2) returning id`, [
          `${alicePublishedId}/photo1.jpg`,
          alice,
        ]),
      );
      expect(r.rows).toHaveLength(1);
    });

    it("an unrelated user cannot upload into someone else's listing folder", async () => {
      await asUser(db, bob, async () => {
        await expect(
          db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('product-images', $1, $2)`, [
            `${aliceDraftId}/intrusion.jpg`,
            bob,
          ]),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("a business member can upload into the business listing's folder", async () => {
      const r = await asUser(db, dave, () =>
        db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('product-images', $1, $2) returning id`, [
          `${aliceBusinessListingId}/staff-photo.jpg`,
          dave,
        ]),
      );
      expect(r.rows).toHaveLength(1);
    });

    it("anon cannot read images belonging to a draft listing", async () => {
      await db.query("reset role");
      await db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('product-images', $1, $2)`, [
        `${aliceDraftId}/secret.jpg`,
        alice,
      ]);
      await asAnon(db, async () => {
        const r = await db.query(`select id from storage.objects where bucket_id='product-images' and name like $1`, [
          `${aliceDraftId}/%`,
        ]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("anon can read images belonging to a published listing", async () => {
      await asAnon(db, async () => {
        const r = await db.query(`select id from storage.objects where bucket_id='product-images' and name like $1`, [
          `${alicePublishedId}/%`,
        ]);
        expect(r.rows.length).toBeGreaterThan(0);
      });
    });

    it("an unrelated user cannot delete another seller's image", async () => {
      const r = await asUser(db, bob, () =>
        db.query(`delete from storage.objects where bucket_id='product-images' and name like $1`, [`${alicePublishedId}/%`]),
      );
      expect(r.affectedRows).toBe(0);
    });

    it("the owner can delete their own image", async () => {
      const r = await asUser(db, alice, () =>
        db.query(`delete from storage.objects where bucket_id='product-images' and name like $1`, [`${alicePublishedId}/%`]),
      );
      expect(r.affectedRows).toBeGreaterThan(0);
    });
  });

  describe("the storage_path <-> product_id binding on product_images", () => {
    it("cannot register an image row pointing at a different product's storage folder", async () => {
      await asUser(db, bob, async () => {
        const otherId = "00000000-0000-4000-8000-000000000000";
        await expect(
          db.query(`insert into public.product_images (product_id, storage_path) values ($1, $2)`, [
            aliceDraftId,
            `${otherId}/stolen.jpg`,
          ]),
        ).rejects.toThrow(); // blocked by RLS (not the owner) before the CHECK constraint is even reached
      });
    });

    it("the constraint itself rejects a mismatched path even for the actual owner", async () => {
      await asUser(db, alice, async () => {
        const otherId = "00000000-0000-4000-8000-000000000000";
        await expect(
          db.query(`insert into public.product_images (product_id, storage_path) values ($1, $2)`, [
            aliceDraftId,
            `${otherId}/mismatched.jpg`,
          ]),
        ).rejects.toThrow(/product_images_storage_path_matches_product/);
      });
    });
  });
});
