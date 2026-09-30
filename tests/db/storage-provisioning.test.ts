import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 15B (C-3): storage.buckets rows created by
 * 20261014090000_storage_bucket_provisioning.sql. Proves bucket
 * existence/config is now part of the migration history itself, and that
 * this migration changes nothing about storage.objects RLS — the
 * pre-existing product-images/verification-documents policy behaviour
 * (already covered in depth by listings.test.ts, verification.test.ts,
 * business.test.ts) still holds.
 *
 * verification-documents' size limit is re-asserted at its Phase 18
 * value (2 MiB, lowered from 10 MiB by
 * 20261015090000_identity_verification_privacy_and_size.sql) — this file
 * always reflects the bucket's current, full-migration-chain state, not
 * a snapshot of Phase 15B alone.
 */
describe("storage bucket provisioning (Phase 15B, C-3)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  async function bucket(id: string) {
    const r = await db.query<{ id: string; public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1`,
      [id],
    );
    return r.rows[0];
  }

  it("A. both buckets exist after migrations", async () => {
    expect(await bucket("product-images")).toBeDefined();
    expect(await bucket("verification-documents")).toBeDefined();
  });

  it("B. both remain private", async () => {
    expect((await bucket("product-images")).public).toBe(false);
    expect((await bucket("verification-documents")).public).toBe(false);
  });

  it("C. size limits: 5MiB images (config.toml), 2MiB documents (Phase 18)", async () => {
    expect(Number((await bucket("product-images")).file_size_limit)).toBe(5 * 1024 * 1024);
    expect(Number((await bucket("verification-documents")).file_size_limit)).toBe(2097152);
  });

  it("D. MIME restrictions match config.toml", async () => {
    expect((await bucket("product-images")).allowed_mime_types.sort()).toEqual(["image/jpeg", "image/png", "image/webp"].sort());
    expect((await bucket("verification-documents")).allowed_mime_types.sort()).toEqual(["application/pdf", "image/jpeg", "image/png"].sort());
  });

  it("re-running bucket provisioning is idempotent and never flips a bucket public", async () => {
    await db.query(
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       values ('product-images', 'product-images', false, 5242880, array['image/png','image/jpeg','image/webp'])
       on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types`,
    );
    const rows = await db.query(`select count(*)::int as n from storage.buckets where id = 'product-images'`);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
    expect((await bucket("product-images")).public).toBe(false);
  });

  it("E. existing storage.objects RLS is untouched — owner can upload under their own product path, a stranger cannot read it", async () => {
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    const seller = await makeUser(db, "Storage Provisioning Seller");
    const stranger = await makeUser(db, "Storage Provisioning Stranger");
    const product = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
       values ('parent', $1, $2, 'Storage Test Item', 'good', 1000, 'draft') returning id`,
      [seller, cat.rows[0].id],
    );
    const productId = product.rows[0].id;
    const path = `${productId}/photo.jpg`;

    const insert = await asUser(db, seller, () =>
      db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('product-images', $1, $2)`, [path, seller]),
    );
    expect(insert.affectedRows).toBe(1);

    // Draft listing: owner can read, a stranger (not the owner, no admin) cannot.
    const ownRead = await asUser(db, seller, () => db.query(`select id from storage.objects where bucket_id = 'product-images' and name = $1`, [path]));
    expect(ownRead.rows).toHaveLength(1);
    const strangerRead = await asUser(db, stranger, () => db.query(`select id from storage.objects where bucket_id = 'product-images' and name = $1`, [path]));
    expect(strangerRead.rows).toHaveLength(0);
  });

  it("F. anonymous callers still cannot upload to either bucket", async () => {
    await expect(
      asAnon(db, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('product-images', 'x/y.jpg', null)`)),
    ).rejects.toThrow();
    await expect(
      asAnon(db, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', 'x/y/id-document.jpg', null)`)),
    ).rejects.toThrow();
  });
});
