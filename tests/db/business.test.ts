import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 6: business seller onboarding & storefront foundation —
 * exercised against the real migration SQL and real Postgres, the same
 * method as every other tests/db/*.test.ts file.
 *
 * Design note this file's tests encode: business CREATION (the entity
 * shell) is allowed for any authenticated user regardless of Phase 5
 * personal verification — the same "drafts are always allowed" precedent
 * listings already established. What's actually gated is OPERATING as a
 * business seller: publishing a listing requires BOTH the acting
 * individual's own Phase 5 verification AND the business's own
 * verification_status = 'verified' (Phase 6's new trigger extension).
 */
describe("business seller onboarding & storefront", () => {
  let db: PGlite;
  let categoryId: string;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  async function createBusinessAsUser(ownerId: string, businessName: string, slug: string) {
    return asUser(db, ownerId, () =>
      db.query<{ id: string }>(
        `insert into public.businesses (owner_profile_id, business_name, slug) values ($1, $2, $3) returning id`,
        [ownerId, businessName, slug],
      ),
    );
  }

  /** Fixture convenience — creates AND fully verifies a business (raw, as postgres) so tests can focus on what they're actually testing. */
  async function makeVerifiedBusiness(ownerId: string, businessName: string, slug: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `insert into public.businesses (owner_profile_id, business_name, slug, verification_status) values ($1, $2, $3, 'verified') returning id`,
      [ownerId, businessName, slug],
    );
    return r.rows[0].id;
  }

  async function makeBusinessProduct(businessId: string, title: string, overrides: { status?: "draft" | "published" } = {}) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('business', $1, $2, $3, 'good', 80000, $4, true, true)
       returning id`,
      [businessId, categoryId, title, overrides.status ?? "draft"],
    );
    return r.rows[0].id;
  }

  describe("business creation", () => {
    it("1. a fully verified user can create a business", async () => {
      const owner = await makeUser(db, "Create Biz Owner A"); // fully verified by default
      const r = await createBusinessAsUser(owner, "Little Treasures", "little-treasures-a");
      expect(r.rows).toHaveLength(1);
    });

    it("a user who is not yet Phase-5-verified can still create the business entity itself (same 'drafts always allowed' precedent as listings) — see this file's own header comment", async () => {
      const owner = await makeUser(db, "Create Biz Owner B", { verified: false });
      const r = await createBusinessAsUser(owner, "Bootstrap Baby Co", "bootstrap-baby-co");
      expect(r.rows).toHaveLength(1);
      await db.query("reset role");
      const row = await db.query<{ verification_status: string }>(`select verification_status from public.businesses where id = $1`, [r.rows[0].id]);
      expect(row.rows[0].verification_status).toBe("unverified");
    });

    it("3. owner_profile_id cannot be spoofed — RLS rejects an insert claiming a different owner", async () => {
      const owner = await makeUser(db, "Spoof Owner A");
      const stranger = await makeUser(db, "Spoof Owner B");
      await asUser(db, stranger, async () => {
        await expect(
          db.query(`insert into public.businesses (owner_profile_id, business_name, slug) values ($1, 'Spoofed', 'spoofed-biz')`, [owner]),
        ).rejects.toThrow();
      });
    });

    it("4a. a duplicate slug is rejected at the database level", async () => {
      const ownerA = await makeUser(db, "Dup Slug Owner A");
      const ownerB = await makeUser(db, "Dup Slug Owner B");
      await createBusinessAsUser(ownerA, "First Shop", "shared-slug");
      await asUser(db, ownerB, async () => {
        await expect(
          db.query(`insert into public.businesses (owner_profile_id, business_name, slug) values ($1, 'Second Shop', 'shared-slug')`, [ownerB]),
        ).rejects.toThrow(/unique/i);
      });
    });

    it("4b. an invalid slug format is rejected at the database level", async () => {
      const owner = await makeUser(db, "Bad Slug Owner");
      await asUser(db, owner, async () => {
        await expect(
          db.query(`insert into public.businesses (owner_profile_id, business_name, slug) values ($1, 'Bad Slug Co', 'Not A Valid Slug!')`, [owner]),
        ).rejects.toThrow(/businesses_slug_format/i);
      });
    });
  });

  describe("ownership", () => {
    it("5. the owner can manage (update) their business", async () => {
      const owner = await makeUser(db, "Manage Owner A");
      const created = await createBusinessAsUser(owner, "Manage Me", "manage-me-a");
      const r = await asUser(db, owner, () => db.query(`update public.businesses set business_name = 'Renamed' where id = $1`, [created.rows[0].id]));
      expect(r.affectedRows).toBe(1);
    });

    it("6. another user cannot manage the business", async () => {
      const owner = await makeUser(db, "Manage Owner B");
      const stranger = await makeUser(db, "Manage Stranger B");
      const created = await createBusinessAsUser(owner, "Not Yours", "not-yours-b");
      const r = await asUser(db, stranger, () => db.query(`update public.businesses set business_name = 'Hacked' where id = $1`, [created.rows[0].id]));
      expect(r.affectedRows).toBe(0);
    });

    it("7. another user cannot modify business listings", async () => {
      const owner = await makeUser(db, "Listing Owner C");
      const stranger = await makeUser(db, "Listing Stranger C");
      const businessId = await makeVerifiedBusiness(owner, "Listing Biz C", "listing-biz-c");
      const productId = await makeBusinessProduct(businessId, "Not Editable");
      const r = await asUser(db, stranger, () => db.query(`update public.products set price_cents = 1 where id = $1`, [productId]));
      expect(r.affectedRows).toBe(0);
    });

    it("8. an unauthorized user cannot publish another business's listing", async () => {
      const owner = await makeUser(db, "Publish Owner D");
      const stranger = await makeUser(db, "Publish Stranger D");
      const businessId = await makeVerifiedBusiness(owner, "Publish Biz D", "publish-biz-d");
      const productId = await makeBusinessProduct(businessId, "Not Publishable");
      const r = await asUser(db, stranger, () => db.query(`update public.products set status = 'published' where id = $1`, [productId]));
      expect(r.affectedRows).toBe(0);
      await db.query("reset role");
      const check = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(check.rows[0].status).toBe("draft");
    });

    it("business_members: only the owner can add a member — a non-owner (even an existing member) cannot add themselves or anyone else", async () => {
      const owner = await makeUser(db, "Members Owner E2");
      const businessId = await makeVerifiedBusiness(owner, "Members Biz E2", "members-biz-e2");
      const stranger = await makeUser(db, "Members Stranger E2");

      // An INSERT that violates RLS throws (a rejected promise), unlike
      // an UPDATE/DELETE outside a caller's own rows, which silently
      // matches 0 rows — the same established distinction this
      // project's own tests/db/rls.test.ts header comment documents.
      await asUser(db, stranger, async () => {
        await expect(db.query(`insert into public.business_members (business_id, profile_id) values ($1, $2)`, [businessId, stranger])).rejects.toThrow();
      });

      await db.query("reset role");
      const check = await db.query(`select 1 from public.business_members where business_id = $1 and profile_id = $2`, [businessId, stranger]);
      expect(check.rows).toHaveLength(0);
    });

    it("business_members: the owner CAN add a member, and that member then gains is_business_member()-scoped authorization (e.g. creating a listing)", async () => {
      const owner = await makeUser(db, "Members Owner E3");
      const businessId = await makeVerifiedBusiness(owner, "Members Biz E3", "members-biz-e3");
      const member = await makeUser(db, "Members Staff E3");

      const insert = await asUser(db, owner, () => db.query(`insert into public.business_members (business_id, profile_id) values ($1, $2)`, [businessId, member]));
      expect(insert.affectedRows).toBe(1);

      const created = await asUser(db, member, () =>
        db.query<{ id: string }>(
          `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
           values ('business', $1, $2, 'Staff-created Toy', 'good', 50000, 'draft', true, true) returning id`,
          [businessId, categoryId],
        ),
      );
      expect(created.rows).toHaveLength(1);
    });
  });

  describe("business listings", () => {
    it("9/10/11. a fully verified, authorized business seller can create and publish a listing, correctly stamped seller_type + business_id", async () => {
      const owner = await makeUser(db, "Full Path Owner"); // fully verified individual
      const businessId = await makeVerifiedBusiness(owner, "Full Path Biz", "full-path-biz");
      const productId = await asUser(db, owner, () =>
        db.query<{ id: string }>(
          `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
           values ('business', $1, $2, 'Full Path Toy', 'good', 50000, 'draft', true, true) returning id`,
          [businessId, categoryId],
        ),
      );
      const publish = await asUser(db, owner, () => db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId.rows[0].id]));
      expect(publish.affectedRows).toBe(1);

      await db.query("reset role");
      const row = await db.query<{ seller_type: string; business_id: string; status: string }>(
        `select seller_type, business_id, status from public.products where id = $1`,
        [productId.rows[0].id],
      );
      expect(row.rows[0]).toEqual({ seller_type: "business", business_id: businessId, status: "published" });
    });

    it("12. a client cannot spoof another business's id when creating a listing", async () => {
      const realOwner = await makeUser(db, "Real Owner E");
      const businessId = await makeVerifiedBusiness(realOwner, "Real Biz E", "real-biz-e");
      const attacker = await makeUser(db, "Listing Attacker E");
      await asUser(db, attacker, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
             values ('business', $1, $2, 'Stolen Toy', 'good', 50000, 'draft', true, true)`,
            [businessId, categoryId],
          ),
        ).rejects.toThrow();
      });
    });

    it("seller_type/business_id cannot be mismatched — products_seller_matches_type CHECK rejects seller_type='parent' with a business_id attached, and vice versa", async () => {
      const owner = await makeUser(db, "Mismatch Owner E1b");
      const businessId = await makeVerifiedBusiness(owner, "Mismatch Biz E1b", "mismatch-biz-e1b");

      // A client claiming seller_type='parent' cannot smuggle a business_id in alongside it.
      await asUser(db, owner, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, seller_profile_id, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
             values ('parent', $1, $2, $3, 'Mismatch Toy A', 'good', 50000, 'draft', true, true)`,
            [owner, businessId, categoryId],
          ),
        ).rejects.toThrow(/products_seller_matches_type/i);
      });

      // Nor the reverse: seller_type='business' without a business_id.
      // Rejected redundantly by two independent layers here — RLS's own
      // business branch (`is_business_member(business_id)`) is already
      // false for a null business_id, on top of the CHECK constraint —
      // defense in depth, so this only asserts *some* rejection rather
      // than pinning which layer reports it first.
      await asUser(db, owner, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, seller_profile_id, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
             values ('business', $1, null, $2, 'Mismatch Toy B', 'good', 50000, 'draft', true, true)`,
            [owner, categoryId],
          ),
        ).rejects.toThrow();
      });
    });

    it("13. an unauthorized (non-member) user cannot create listings for another business", async () => {
      const owner = await makeUser(db, "Member Owner F");
      const businessId = await makeVerifiedBusiness(owner, "Member Biz F", "member-biz-f");
      const nonMember = await makeUser(db, "Non Member F");
      await asUser(db, nonMember, async () => {
        await expect(
          db.query(
            `insert into public.products (seller_type, business_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
             values ('business', $1, $2, 'Non Member Toy', 'good', 50000, 'draft', true, true)`,
            [businessId, categoryId],
          ),
        ).rejects.toThrow();
      });
    });

    it("14a. an unverified INDIVIDUAL cannot publish a listing for their own verified business", async () => {
      const owner = await makeUser(db, "Unverified Owner G", { verified: false });
      const businessId = await makeVerifiedBusiness(owner, "Verified Biz G", "verified-biz-g");
      const productId = await makeBusinessProduct(businessId, "Blocked By Individual");
      await asUser(db, owner, async () => {
        await expect(db.query(`update public.products set status = 'published' where id = $1`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("14b. a fully verified individual cannot publish a listing for their own UNVERIFIED business", async () => {
      const owner = await makeUser(db, "Verified Owner H"); // fully verified individual
      const created = await createBusinessAsUser(owner, "Unverified Biz H", "unverified-biz-h"); // starts unverified
      const productId = await makeBusinessProduct(created.rows[0].id, "Blocked By Business");
      await asUser(db, owner, async () => {
        await expect(db.query(`update public.products set status = 'published' where id = $1`, [productId])).rejects.toThrow(
          /business is not yet verified/i,
        );
      });
      await db.query("reset role");
      const check = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(check.rows[0].status).toBe("draft");
    });

    it("business verification approval unblocks publishing end-to-end (submission -> admin review -> publish succeeds)", async () => {
      const owner = await makeUser(db, "E2E Owner I");
      const admin = await makeUser(db, "E2E Admin I");
      await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
      const created = await createBusinessAsUser(owner, "E2E Biz I", "e2e-biz-i");
      const businessId = created.rows[0].id;

      const productId = await makeBusinessProduct(businessId, "E2E Toy");
      await asUser(db, owner, async () => {
        await expect(db.query(`update public.products set status = 'published' where id = $1`, [productId])).rejects.toThrow(
          /business is not yet verified/i,
        );
      });

      const submission = await asUser(db, owner, () =>
        db.query<{ id: string }>(
          `insert into public.business_verifications (business_id, document_type, document_storage_path) values ($1, 'registration', 'business/x/doc.pdf') returning id`,
          [businessId],
        ),
      );
      await asUser(db, admin, () => db.query(`select public.review_business_verification($1, 'verified', null)`, [submission.rows[0].id]));

      await db.query("reset role");
      const businessRow = await db.query<{ verification_status: string }>(`select verification_status from public.businesses where id = $1`, [businessId]);
      expect(businessRow.rows[0].verification_status).toBe("verified");

      const publish = await asUser(db, owner, () => db.query(`update public.products set status = 'published' where id = $1`, [productId]));
      expect(publish.affectedRows).toBe(1);
    });
  });

  describe("storefront", () => {
    it("15. the public storefront view returns a verified business", async () => {
      const owner = await makeUser(db, "Storefront Owner J");
      const businessId = await makeVerifiedBusiness(owner, "Storefront Biz J", "storefront-biz-j");
      await asAnon(db, async () => {
        const r = await db.query(`select business_name from public.businesses_public where id = $1`, [businessId]);
        expect(r.rows).toHaveLength(1);
      });
    });

    it("15b. an unverified business's storefront is not publicly visible", async () => {
      const owner = await makeUser(db, "Unverified Storefront Owner J");
      const created = await createBusinessAsUser(owner, "Unverified Storefront Biz J", "unverified-storefront-biz-j");
      await asAnon(db, async () => {
        const r = await db.query(`select business_name from public.businesses_public where id = $1`, [created.rows[0].id]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("16/17. the public storefront view never exposes verification/owner/registration/VAT data", async () => {
      const cols = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'businesses_public'`,
      );
      const names = cols.rows.map((c) => c.column_name);
      expect(names).not.toContain("owner_profile_id");
      expect(names).not.toContain("registration_number");
      expect(names).not.toContain("vat_number");
      expect(names).not.toContain("account_standing");
    });
  });

  describe("orders", () => {
    async function makeCashEligibleVerifiedBusinessSeller(name: string, slug: string) {
      const owner = await makeUser(db, name);
      const businessId = await makeVerifiedBusiness(owner, name, slug);
      return { owner, businessId };
    }

    it("18/19. a business order references business_id and snapshots the 15% (1500 bps) business commission rate", async () => {
      const { owner, businessId } = await makeCashEligibleVerifiedBusinessSeller("Order Biz Owner K", "order-biz-k");
      const productId = await makeBusinessProduct(businessId, "Order Toy K", { status: "published" });
      const buyer = await makeUser(db, "Order Buyer K");
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]));

      await db.query("reset role");
      const order = await db.query<{ business_id: string; seller_type: string; commission_rate_bps: number; commission_amount_cents: string }>(
        `select business_id, seller_type, commission_rate_bps, commission_amount_cents from public.orders where id = $1`,
        [created.rows[0].order_id],
      );
      expect(order.rows[0].business_id).toBe(businessId);
      expect(order.rows[0].seller_type).toBe("business");
      expect(order.rows[0].commission_rate_bps).toBe(1500);
      expect(Number(order.rows[0].commission_amount_cents)).toBe(12000); // 15% of R800
      void owner;
    });

    it("20. create_order() takes no commission/business-spoofing parameters — the client cannot manipulate the rate", async () => {
      const r = await db.query<{ proargnames: string[] }>(`select proargnames from pg_proc where proname = 'create_order'`);
      const argNames = r.rows[0].proargnames;
      for (const forbidden of ["commission_rate", "commission_rate_bps", "commission_amount_cents", "business_id"]) {
        expect(argNames).not.toContain(forbidden);
      }
    });

    it("21. another business cannot access this order", async () => {
      const { businessId: businessK } = await makeCashEligibleVerifiedBusinessSeller("Order Biz Owner L", "order-biz-l");
      const productId = await makeBusinessProduct(businessK, "Order Toy L", { status: "published" });
      const buyer = await makeUser(db, "Order Buyer L");
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'online')`, [productId]));

      const otherOwner = await makeUser(db, "Other Business Owner L");
      await makeVerifiedBusiness(otherOwner, "Other Business L", "other-business-l");
      const r = await asUser(db, otherOwner, () => db.query(`select id from public.orders where id = $1`, [created.rows[0].order_id]));
      expect(r.rows).toHaveLength(0);
    });

    it("CONFIRMED AND FIXED: decline_cash_order() does not republish a business's listing once the business's own verification has lapsed", async () => {
      const owner = await makeUser(db, "Decline Biz Lapse Owner");
      const businessId = await makeVerifiedBusiness(owner, "Decline Biz Lapse Biz", "decline-biz-lapse-biz");
      await db.query(`update public.businesses set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [businessId]);
      const productId = await makeBusinessProduct(businessId, "Decline Biz Lapse Toy", { status: "published" });
      const buyer = await makeUser(db, "Decline Biz Lapse Buyer");
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));

      // Business verification lapses after the order exists.
      await asUser(db, owner, () =>
        db.query(`insert into public.business_verifications (business_id, document_type, document_storage_path) values ($1, 'reg', 'business/x/doc.pdf')`, [businessId]),
      );
      await db.query("reset role");
      const lapsed = await db.query<{ verification_status: string }>(`select verification_status from public.businesses where id = $1`, [businessId]);
      expect(lapsed.rows[0].verification_status).toBe("pending");

      await asUser(db, owner, () => db.query(`select public.decline_cash_order($1)`, [created.rows[0].order_id]));

      await db.query("reset role");
      const product = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      // Before the fix this was 'published' — republished with no fresh
      // check, the same category of bug Phase 5 found and fixed for
      // individuals, now closed for businesses too.
      expect(product.rows[0].status).toBe("draft");
    });

    it("decline_cash_order() still republishes normally for a business that remains verified (no regression)", async () => {
      const owner = await makeUser(db, "Decline Biz Still Verified Owner");
      const businessId = await makeVerifiedBusiness(owner, "Decline Biz Still Verified", "decline-biz-still-verified");
      await db.query(`update public.businesses set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [businessId]);
      const productId = await makeBusinessProduct(businessId, "Decline Biz Still Verified Toy", { status: "published" });
      const buyer = await makeUser(db, "Decline Biz Still Verified Buyer");
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));

      await asUser(db, owner, () => db.query(`select public.decline_cash_order($1)`, [created.rows[0].order_id]));

      await db.query("reset role");
      const product = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(product.rows[0].status).toBe("published");
    });
  });

  describe("security", () => {
    it("22. business verification_status cannot be client-edited directly", async () => {
      const owner = await makeUser(db, "No Self Verify Biz Owner");
      const created = await createBusinessAsUser(owner, "No Self Verify Biz", "no-self-verify-biz");
      await asUser(db, owner, async () => {
        await expect(
          db.query(`update public.businesses set verification_status = 'verified' where id = $1`, [created.rows[0].id]),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("23. business account_standing cannot be client-edited directly", async () => {
      const owner = await makeUser(db, "No Self Standing Biz Owner");
      const created = await createBusinessAsUser(owner, "No Self Standing Biz", "no-self-standing-biz");
      await asUser(db, owner, async () => {
        await expect(
          db.query(`update public.businesses set account_standing = 'suspended' where id = $1`, [created.rows[0].id]),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("24. business ratings/statistics cannot be client-edited directly", async () => {
      const owner = await makeUser(db, "No Self Rating Biz Owner");
      const created = await createBusinessAsUser(owner, "No Self Rating Biz", "no-self-rating-biz");
      await asUser(db, owner, async () => {
        await expect(
          db.query(`update public.businesses set rating_average = 5.0, completed_transaction_count = 999 where id = $1`, [created.rows[0].id]),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("25a. an ordinary user cannot read another business's verification documents in storage", async () => {
      const owner = await makeUser(db, "Doc Owner Biz M");
      const businessId = await makeVerifiedBusiness(owner, "Doc Biz M", "doc-biz-m");
      const path = `business/${businessId}/${crypto.randomUUID()}/document.pdf`;
      await asUser(db, owner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, owner]));

      const stranger = await makeUser(db, "Doc Stranger M");
      const r = await asUser(db, stranger, () => db.query(`select * from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(r.rows).toHaveLength(0);
    });

    it("25b. an admin CAN read a business's verification document (for review)", async () => {
      const owner = await makeUser(db, "Doc Owner Biz N");
      const admin = await makeUser(db, "Doc Admin N");
      await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
      const businessId = await makeVerifiedBusiness(owner, "Doc Biz N", "doc-biz-n");
      const path = `business/${businessId}/${crypto.randomUUID()}/document.pdf`;
      await asUser(db, owner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, owner]));

      const r = await asUser(db, admin, () => db.query(`select * from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(r.rows).toHaveLength(1);
    });

    it("a non-admin cannot approve a business verification submission", async () => {
      const owner = await makeUser(db, "No Approve Owner O");
      const businessId = await makeVerifiedBusiness(owner, "No Approve Biz O", "no-approve-biz-o");
      const nonAdmin = await makeUser(db, "No Approve Stranger O");
      const submission = await asUser(db, owner, () =>
        db.query<{ id: string }>(
          `insert into public.business_verifications (business_id, document_type, document_storage_path) values ($1, 'reg', 'business/x/doc.pdf') returning id`,
          [businessId],
        ),
      );
      await asUser(db, nonAdmin, async () => {
        await expect(db.query(`select public.review_business_verification($1, 'verified', null)`, [submission.rows[0].id])).rejects.toThrow(
          /admin authorization required/i,
        );
      });
    });
  });

  describe("regression", () => {
    it("26/28. parent seller publish/verification gate remains intact after the business trigger extension", async () => {
      const unverifiedParent = await makeUser(db, "Regression Parent Seller", { verified: false });
      const productId = await db.query<{ id: string }>(
        `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
         values ('parent', $1, $2, 'Regression Parent Toy', 'good', 10000, 'draft', true, true) returning id`,
        [unverifiedParent, categoryId],
      );
      await asUser(db, unverifiedParent, async () => {
        await expect(db.query(`update public.products set status = 'published' where id = $1`, [productId.rows[0].id])).rejects.toThrow(
          /account verification required/i,
        );
      });

      const verifiedParent = await makeUser(db, "Regression Verified Parent Seller");
      const productId2 = await db.query<{ id: string }>(
        `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
         values ('parent', $1, $2, 'Regression Verified Parent Toy', 'good', 10000, 'draft', true, true) returning id`,
        [verifiedParent, categoryId],
      );
      const r = await asUser(db, verifiedParent, () => db.query(`update public.products set status = 'published' where id = $1`, [productId2.rows[0].id]));
      expect(r.affectedRows).toBe(1);
    });

    it("27. Phase 5 buy gate remains intact for a business's own listing (unverified buyer rejected)", async () => {
      const owner = await makeUser(db, "Regression Biz Owner P");
      const businessId = await makeVerifiedBusiness(owner, "Regression Biz P", "regression-biz-p");
      const productId = await makeBusinessProduct(businessId, "Regression Biz Toy P", { status: "published" });
      const unverifiedBuyer = await makeUser(db, "Regression Unverified Buyer P", { verified: false });
      await asUser(db, unverifiedBuyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });
  });
});
