import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Human-readable verification-document storage folders
 * (20261015090000_identity_verification_privacy_and_size.sql) — exercised
 * against the real migration SQL and real Postgres. The old
 * "<user-id>/<random-token>/..." convention and its own RLS branch are
 * proven unchanged/still-working in tests/db/verification.test.ts; this
 * file covers what's new: allocate_verification_folder_slug()'s
 * allocation/reuse/collision behaviour, the new folder-slug-based RLS
 * branch, and that old and new conventions coexist for the same bucket.
 */
describe("verification folder allocation (Phase 18)", () => {
  let db: PGlite;

  async function makeAdmin(name: string): Promise<string> {
    const id = await makeUser(db, name);
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [id]);
    return id;
  }

  const allocate = (as: string, baseName: string) =>
    asUser(db, as, () => db.query<{ allocate_verification_folder_slug: string }>(`select public.allocate_verification_folder_slug($1)`, [baseName]));

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("allocation and reuse", () => {
    it("A. a first submission gets the base name with suffix _01", async () => {
      const user = await makeUser(db, "Folder Alloc A");
      const r = await allocate(user, "Lehlohonolo_Maishoane");
      expect(r.rows[0].allocate_verification_folder_slug).toBe("Lehlohonolo_Maishoane_01");
    });

    it("B. a resubmission by the SAME user returns the SAME folder, never a new suffix", async () => {
      const user = await makeUser(db, "Folder Alloc B");
      const first = (await allocate(user, "Same_Person")).rows[0].allocate_verification_folder_slug;
      const second = (await allocate(user, "Same_Person")).rows[0].allocate_verification_folder_slug;
      const third = (await allocate(user, "A_Completely_Different_Base")).rows[0].allocate_verification_folder_slug;
      expect(second).toBe(first);
      // Even a different base name on resubmission doesn't reallocate —
      // the existing row for this profile wins, matching "resubmissions
      // stay logically associated with that user's existing folder."
      expect(third).toBe(first);
    });

    it("C. a different profile with the same base name gets the next free suffix, never the same folder", async () => {
      const userA = await makeUser(db, "Folder Alloc C1");
      const userB = await makeUser(db, "Folder Alloc C2");
      const a = (await allocate(userA, "Common_Name")).rows[0].allocate_verification_folder_slug;
      const b = (await allocate(userB, "Common_Name")).rows[0].allocate_verification_folder_slug;
      expect(a).toBe("Common_Name_01");
      expect(b).toBe("Common_Name_02");
    });

    it("D. a third same-named profile continues the sequence (_03), not restarting or colliding", async () => {
      const u1 = await makeUser(db, "Folder Alloc D1");
      const u2 = await makeUser(db, "Folder Alloc D2");
      const u3 = await makeUser(db, "Folder Alloc D3");
      await allocate(u1, "Sequence_Name");
      await allocate(u2, "Sequence_Name");
      const third = (await allocate(u3, "Sequence_Name")).rows[0].allocate_verification_folder_slug;
      expect(third).toBe("Sequence_Name_03");
    });
  });

  describe("concurrency safety", () => {
    // A true concurrent race between DIFFERENT identities can't be
    // exercised safely through this harness's asUser() (it models a
    // "session" as mutable GUCs on one shared PGlite connection, so
    // overlapping async calls for different auth.uid() values can
    // interleave their own set/reset statements) — this is exactly why
    // every other concurrency test in this codebase's tests/db/*.test.ts
    // only ever races multiple calls for the SAME identity (see e.g.
    // messaging.test.ts's thread-creation race). The suffix-increment
    // logic for genuinely different people is already proven above (C,
    // D) with real, sequential calls; what's actually safety-critical —
    // the retry-on-unique_violation loop firing under real, overlapping
    // transactions — is exercised for real by the SAME-identity race
    // directly below.
    it("F. concurrent resubmission calls for the SAME profile all resolve to exactly one allocated folder — never two rows for one person", async () => {
      const user = await makeUser(db, "Folder Concurrency F");
      const results = await Promise.all(Array.from({ length: 5 }, () => allocate(user, "Racing_Self")));
      const names = results.map((r) => r.rows[0].allocate_verification_folder_slug);
      expect(new Set(names).size).toBe(1);

      await db.query("reset role");
      const rows = await db.query(`select count(*)::int as n from public.verification_folder_slugs where profile_id = $1`, [user]);
      expect((rows.rows[0] as { n: number }).n).toBe(1);
    });
  });

  describe("access control", () => {
    it("G. anonymous cannot allocate a folder", async () => {
      await expect(asAnon(db, () => db.query(`select public.allocate_verification_folder_slug('x')`))).rejects.toThrow();
    });

    it("H. a user can read their own verification_folder_slugs row (required for their own storage access to work) but never another user's", async () => {
      const user = await makeUser(db, "Folder Access H");
      const stranger = await makeUser(db, "Folder Access H Stranger");
      await allocate(user, "Locked_Down");
      const ownRead = await asUser(db, user, () => db.query(`select * from public.verification_folder_slugs where profile_id = $1`, [user]));
      expect(ownRead.rows).toHaveLength(1);
      const strangerRead = await asUser(db, stranger, () => db.query(`select * from public.verification_folder_slugs where profile_id = $1`, [user]));
      expect(strangerRead.rows).toHaveLength(0);
    });

    it("an admin CAN read verification_folder_slugs", async () => {
      const user = await makeUser(db, "Folder Access Admin Target");
      const admin = await makeAdmin("Folder Access Admin");
      await allocate(user, "Admin_Readable");
      const r = await asUser(db, admin, () => db.query(`select folder_name from public.verification_folder_slugs where profile_id = $1`, [user]));
      expect(r.rows).toHaveLength(1);
    });

    it("no authenticated client can insert/update/delete verification_folder_slugs directly — only the function can write it", async () => {
      const user = await makeUser(db, "Folder Access Direct Write");
      await expect(
        asUser(db, user, () => db.query(`insert into public.verification_folder_slugs (profile_id, folder_name) values ($1, 'Forged_01')`, [user])),
      ).rejects.toThrow();
    });
  });

  describe("storage RLS — new folder-slug convention", () => {
    it("I. the owner can upload under their own allocated folder", async () => {
      const user = await makeUser(db, "Folder Storage I");
      const folder = (await allocate(user, "Storage_Owner")).rows[0].allocate_verification_folder_slug;
      const path = `${folder}/id-document.jpg`;
      const r = await asUser(db, user, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, user]));
      expect(r.affectedRows).toBe(1);
    });

    it("J. a different user cannot upload into someone else's allocated folder", async () => {
      const owner = await makeUser(db, "Folder Storage J Owner");
      const stranger = await makeUser(db, "Folder Storage J Stranger");
      const folder = (await allocate(owner, "Storage_Not_Yours")).rows[0].allocate_verification_folder_slug;
      await expect(
        asUser(db, stranger, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [`${folder}/id-document.jpg`, stranger])),
      ).rejects.toThrow();
    });

    it("K. the owner can read their own new-convention document; a stranger cannot; an admin can", async () => {
      const owner = await makeUser(db, "Folder Storage K Owner");
      const stranger = await makeUser(db, "Folder Storage K Stranger");
      const admin = await makeAdmin("Folder Storage K Admin");
      const folder = (await allocate(owner, "Storage_Read_Test")).rows[0].allocate_verification_folder_slug;
      const path = `${folder}/id-document.jpg`;
      await asUser(db, owner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, owner]));

      const ownRead = await asUser(db, owner, () => db.query(`select id from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(ownRead.rows).toHaveLength(1);
      const strangerRead = await asUser(db, stranger, () => db.query(`select id from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(strangerRead.rows).toHaveLength(0);
      const adminRead = await asUser(db, admin, () => db.query(`select id from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(adminRead.rows).toHaveLength(1);
    });

    it("L. old-convention and new-convention documents coexist — an admin reads both without any special-casing", async () => {
      const oldOwner = await makeUser(db, "Folder Storage L Old");
      const newOwner = await makeUser(db, "Folder Storage L New");
      const admin = await makeAdmin("Folder Storage L Admin");

      const oldPath = `${oldOwner}/${crypto.randomUUID()}/id-document.jpg`;
      await asUser(db, oldOwner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [oldPath, oldOwner]));

      const folder = (await allocate(newOwner, "Coexist_New")).rows[0].allocate_verification_folder_slug;
      const newPath = `${folder}/id-document.jpg`;
      await asUser(db, newOwner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [newPath, newOwner]));

      const r = await asUser(db, admin, () =>
        db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'verification-documents' and name in ($1, $2)`, [oldPath, newPath]),
      );
      expect(r.rows.map((row) => row.name).sort()).toEqual([newPath, oldPath].sort());
    });
  });
});
