import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 5: identity, account verification & transaction access control —
 * exercised against the real migration SQL and real Postgres, the same
 * method as every other tests/db/*.test.ts file.
 *
 * Account verification (confirmed email + confirmed phone) is derived
 * live from auth.users every call — never cached, never client-settable.
 * Identity verification is a manual-review process on
 * identity_verifications, with profiles.identity_verification kept in
 * sync by a trigger. can_transact()/is_profile_fully_verified() are the
 * single reusable gate, layered underneath (not instead of) Phase 4C's
 * own cash-eligibility criteria.
 */
describe("identity & account verification", () => {
  let db: PGlite;
  let categoryId: string;
  let idCounter = 0;

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  function freshIdNumber(): string {
    idCounter += 1;
    return `9001015${String(idCounter).padStart(6, "0")}`;
  }

  async function makeProduct(seller: string, title: string, overrides: { status?: "draft" | "published" | "archived" } = {}) {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, $3, 'good', 50000, $4, true, true)
       returning id`,
      [seller, categoryId, title, overrides.status ?? "draft"],
    );
    return r.rows[0].id;
  }

  async function makeAdmin(db: PGlite, name: string): Promise<string> {
    const id = await makeUser(db, name);
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [id]);
    return id;
  }

  /** Direct INSERT, as the submitting user — mirrors what the real submission server action does at the RLS layer. */
  async function submitIdentity(profileId: string, idNumber: string) {
    return asUser(db, profileId, () =>
      db.query<{ id: string }>(
        `insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number)
         values ($1, 'manual', 'sa_id', $2, $3) returning id`,
        [profileId, `${profileId}/${crypto.randomUUID()}/id-document.jpg`, idNumber],
      ),
    );
  }

  async function review(adminId: string, submissionId: string, decision: "verified" | "rejected", notes?: string) {
    return asUser(db, adminId, () =>
      db.query(`select public.review_identity_verification($1, $2, $3)`, [submissionId, decision, notes ?? null]),
    );
  }

  describe("account verification (live from auth.users)", () => {
    it("1. confirmed email + confirmed phone -> account verified (via can_transact(), with identity also verified)", async () => {
      const user = await makeUser(db, "Fully Verified A"); // makeUser() defaults to fully verified
      const r = await asUser(db, user, () => db.query<{ can_transact: boolean }>(`select public.can_transact()`));
      expect(r.rows[0].can_transact).toBe(true);
    });

    it("2. unconfirmed email -> not account verified, even with identity verified", async () => {
      const user = await makeUser(db, "Unconfirmed Email A");
      await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [user]);
      const r = await asUser(db, user, () => db.query<{ can_transact: boolean }>(`select public.can_transact()`));
      expect(r.rows[0].can_transact).toBe(false);
    });

    it("3. unconfirmed phone -> not account verified, even with identity verified", async () => {
      const user = await makeUser(db, "Unconfirmed Phone A");
      await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [user]);
      const r = await asUser(db, user, () => db.query<{ can_transact: boolean }>(`select public.can_transact()`));
      expect(r.rows[0].can_transact).toBe(false);
    });

    it("client cannot self-set account verification — no column grant permits it", async () => {
      const user = await makeUser(db, "No Self Verify A");
      // account_verification/identity_verification are excluded from
      // authenticated's UPDATE column grant entirely (unchanged since
      // the foundation phase) — a column-level grant violation throws,
      // unlike a row-level RLS denial (which silently matches 0 rows).
      await asUser(db, user, async () => {
        await expect(db.query(`update public.profiles set account_verification = 'verified' where id = $1`, [user])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });
  });

  describe("identity verification lifecycle", () => {
    it("4. no identity submission -> latest status is null (treated as unverified)", async () => {
      const user = await makeUser(db, "No Submission A", { verified: false });
      const r = await db.query<{ latest_identity_verification_status: string | null }>(
        `select public.latest_identity_verification_status($1)`,
        [user],
      );
      // Internal function — call as postgres/service context since it's not granted to authenticated.
      expect(r.rows[0].latest_identity_verification_status).toBeNull();
    });

    it("5. pending identity -> latest status is pending", async () => {
      const user = await makeUser(db, "Pending Identity A", { verified: false });
      await submitIdentity(user, freshIdNumber());
      await db.query("reset role");
      const r = await db.query<{ latest_identity_verification_status: string }>(
        `select public.latest_identity_verification_status($1)`,
        [user],
      );
      expect(r.rows[0].latest_identity_verification_status).toBe("pending");
      const profile = await db.query<{ identity_verification: string }>(`select identity_verification from public.profiles where id = $1`, [user]);
      expect(profile.rows[0].identity_verification).toBe("pending");
    });

    it("6. approved identity -> latest status is verified", async () => {
      const user = await makeUser(db, "Approved Identity A", { verified: false });
      const admin = await makeAdmin(db, "Approved Identity Admin");
      const submission = await submitIdentity(user, freshIdNumber());
      await review(admin, submission.rows[0].id, "verified");
      await db.query("reset role");
      const profile = await db.query<{ identity_verification: string }>(`select identity_verification from public.profiles where id = $1`, [user]);
      expect(profile.rows[0].identity_verification).toBe("verified");
    });

    it("7. rejected identity -> latest status is rejected", async () => {
      const user = await makeUser(db, "Rejected Identity A", { verified: false });
      const admin = await makeAdmin(db, "Rejected Identity Admin");
      const submission = await submitIdentity(user, freshIdNumber());
      await review(admin, submission.rows[0].id, "rejected", "Document was blurry");
      await db.query("reset role");
      const profile = await db.query<{ identity_verification: string }>(`select identity_verification from public.profiles where id = $1`, [user]);
      expect(profile.rows[0].identity_verification).toBe("rejected");
      const row = await db.query<{ notes: string }>(`select notes from public.identity_verifications where id = $1`, [submission.rows[0].id]);
      expect(row.rows[0].notes).toBe("Document was blurry");
    });

    it("8. rejected + resubmission -> latest state is pending, and the rejected submission remains in history", async () => {
      const user = await makeUser(db, "Resubmit After Reject A", { verified: false });
      const admin = await makeAdmin(db, "Resubmit Reject Admin");
      const first = await submitIdentity(user, freshIdNumber());
      await review(admin, first.rows[0].id, "rejected");
      const second = await submitIdentity(user, freshIdNumber());
      await db.query("reset role");

      const profile = await db.query<{ identity_verification: string }>(`select identity_verification from public.profiles where id = $1`, [user]);
      expect(profile.rows[0].identity_verification).toBe("pending");

      const history = await db.query<{ id: string; status: string }>(
        `select id, status from public.identity_verifications where profile_id = $1 order by created_at`,
        [user],
      );
      expect(history.rows).toHaveLength(2);
      expect(history.rows[0]).toEqual({ id: first.rows[0].id, status: "rejected" });
      expect(history.rows[1]).toEqual({ id: second.rows[0].id, status: "pending" });
    });

    it("9. verified + new submission -> latest state is pending, and the verified submission remains in history", async () => {
      const user = await makeUser(db, "Resubmit After Verify A", { verified: false });
      const admin = await makeAdmin(db, "Resubmit Verify Admin");
      const first = await submitIdentity(user, freshIdNumber());
      await review(admin, first.rows[0].id, "verified");
      await submitIdentity(user, freshIdNumber());
      await db.query("reset role");

      const profile = await db.query<{ identity_verification: string }>(`select identity_verification from public.profiles where id = $1`, [user]);
      expect(profile.rows[0].identity_verification).toBe("pending");

      const history = await db.query<{ status: string }>(`select status from public.identity_verifications where profile_id = $1 order by created_at`, [user]);
      expect(history.rows.map((r) => r.status)).toEqual(["verified", "pending"]);
    });

    it("an unauthenticated user cannot submit identity verification", async () => {
      await asAnon(db, async () => {
        await expect(
          db.query(`insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number) values ($1, 'manual', 'sa_id', 'x', $2)`, [
            crypto.randomUUID(),
            freshIdNumber(),
          ]),
        ).rejects.toThrow();
      });
    });

    it("a user cannot submit a verification for another user's profile_id", async () => {
      const user = await makeUser(db, "Submit For Self A", { verified: false });
      const stranger = await makeUser(db, "Submit For Self Stranger", { verified: false });
      await asUser(db, user, async () => {
        const r = await db.query(
          `insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number) values ($1, 'manual', 'sa_id', 'x', $2)`,
          [stranger, freshIdNumber()],
        );
        // RLS with-check denial on an INSERT throws, not a 0-row match.
        expect(r).toBeUndefined();
      }).catch((e) => {
        expect(e).toBeDefined();
      });
    });

    it("id_number must be 13 digits", async () => {
      const user = await makeUser(db, "Bad Id Format A", { verified: false });
      await asUser(db, user, async () => {
        await expect(
          db.query(
            `insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number) values ($1, 'manual', 'sa_id', 'x', '12345')`,
            [user],
          ),
        ).rejects.toThrow();
      });
    });

    it("a duplicate active submission is not blocked outright — a second pending row for the same profile is allowed (history, not a single mutable record)", async () => {
      const user = await makeUser(db, "Duplicate Pending A", { verified: false });
      await submitIdentity(user, freshIdNumber());
      const second = await submitIdentity(user, freshIdNumber());
      expect(second.rows).toHaveLength(1);
    });
  });

  describe("buying — the verification gate in create_order()", () => {
    it("10. a fully verified user can create an order", async () => {
      const seller = await makeUser(db, "Buy Gate Seller A");
      const buyer = await makeUser(db, "Buy Gate Buyer A");
      const productId = await makeProduct(seller, "Buy Gate Toy A", { status: "published" });
      const r = await asUser(db, buyer, () => db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
      expect(r.rows).toHaveLength(1);
    });

    it("11. unverified email cannot create an order", async () => {
      const seller = await makeUser(db, "Buy Gate Seller B");
      const buyer = await makeUser(db, "Buy Gate Buyer B");
      await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [buyer]);
      const productId = await makeProduct(seller, "Buy Gate Toy B", { status: "published" });
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("12. unverified phone cannot create an order", async () => {
      const seller = await makeUser(db, "Buy Gate Seller C");
      const buyer = await makeUser(db, "Buy Gate Buyer C");
      await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [buyer]);
      const productId = await makeProduct(seller, "Buy Gate Toy C", { status: "published" });
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("13. no identity verification (unverified) cannot create an order", async () => {
      const seller = await makeUser(db, "Buy Gate Seller D");
      const buyer = await makeUser(db, "Buy Gate Buyer D", { verified: false });
      const productId = await makeProduct(seller, "Buy Gate Toy D", { status: "published" });
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("14. pending identity cannot create an order", async () => {
      const seller = await makeUser(db, "Buy Gate Seller E");
      const buyer = await makeUser(db, "Buy Gate Buyer E", { verified: false });
      // Confirm email/phone but leave identity at pending.
      await db.query(`update auth.users set email_confirmed_at = now(), phone_confirmed_at = now() where id = $1`, [buyer]);
      await submitIdentity(buyer, freshIdNumber());
      const productId = await makeProduct(seller, "Buy Gate Toy E", { status: "published" });
      await db.query("reset role");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("15. rejected identity cannot create an order", async () => {
      const seller = await makeUser(db, "Buy Gate Seller F");
      const buyer = await makeUser(db, "Buy Gate Buyer F", { verified: false });
      const admin = await makeAdmin(db, "Buy Gate Admin F");
      await db.query(`update auth.users set email_confirmed_at = now(), phone_confirmed_at = now() where id = $1`, [buyer]);
      const submission = await submitIdentity(buyer, freshIdNumber());
      await review(admin, submission.rows[0].id, "rejected");
      const productId = await makeProduct(seller, "Buy Gate Toy F", { status: "published" });
      await db.query("reset role");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("an unverified buyer cannot bypass the gate by attempting a cash order either", async () => {
      const seller = await makeUser(db, "Buy Gate Cash Seller");
      const buyer = await makeUser(db, "Buy Gate Cash Buyer", { verified: false });
      const productId = await makeProduct(seller, "Buy Gate Cash Toy", { status: "published" });
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });
  });

  describe("selling — the verification gate on listing publication", () => {
    it("16. a fully verified seller can publish a listing", async () => {
      const seller = await makeUser(db, "Sell Gate Seller A");
      const productId = await makeProduct(seller, "Sell Gate Toy A");
      const r = await asUser(db, seller, () =>
        db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
      );
      expect(r.affectedRows).toBe(1);
    });

    it("an unverified seller CAN still create a draft listing", async () => {
      const seller = await makeUser(db, "Sell Gate Draft Seller", { verified: false });
      const productId = await asUser(db, seller, () =>
        db.query<{ id: string }>(
          `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
           values ('parent', $1, $2, 'Draft ok', 'good', 10000, 'draft', true, true) returning id`,
          [seller, categoryId],
        ),
      );
      expect(productId.rows).toHaveLength(1);
    });

    it("17. unverified email cannot publish a listing", async () => {
      const seller = await makeUser(db, "Sell Gate Seller B");
      await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [seller]);
      const productId = await makeProduct(seller, "Sell Gate Toy B");
      await asUser(db, seller, async () => {
        await expect(
          db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
        ).rejects.toThrow(/account verification required/i);
      });
    });

    it("18. unverified phone cannot publish a listing", async () => {
      const seller = await makeUser(db, "Sell Gate Seller C");
      await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [seller]);
      const productId = await makeProduct(seller, "Sell Gate Toy C");
      await asUser(db, seller, async () => {
        await expect(
          db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
        ).rejects.toThrow(/account verification required/i);
      });
    });

    it("19. no identity verification cannot publish a listing", async () => {
      const seller = await makeUser(db, "Sell Gate Seller D", { verified: false });
      await db.query(`update auth.users set email_confirmed_at = now(), phone_confirmed_at = now() where id = $1`, [seller]);
      const productId = await asUser(db, seller, () =>
        db.query<{ id: string }>(
          `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
           values ('parent', $1, $2, 'Sell Gate Toy D', 'good', 10000, 'draft', true, true) returning id`,
          [seller, categoryId],
        ),
      );
      await asUser(db, seller, async () => {
        await expect(
          db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId.rows[0].id]),
        ).rejects.toThrow(/account verification required/i);
      });
    });

    it("20. pending identity cannot publish a listing", async () => {
      const seller = await makeUser(db, "Sell Gate Seller E", { verified: false });
      await db.query(`update auth.users set email_confirmed_at = now(), phone_confirmed_at = now() where id = $1`, [seller]);
      await submitIdentity(seller, freshIdNumber());
      const productId = await makeProduct(seller, "Sell Gate Toy E");
      await db.query("reset role");
      await asUser(db, seller, async () => {
        await expect(
          db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
        ).rejects.toThrow(/account verification required/i);
      });
    });

    it("21. rejected identity cannot publish a listing", async () => {
      const seller = await makeUser(db, "Sell Gate Seller F", { verified: false });
      const admin = await makeAdmin(db, "Sell Gate Admin F");
      await db.query(`update auth.users set email_confirmed_at = now(), phone_confirmed_at = now() where id = $1`, [seller]);
      const submission = await submitIdentity(seller, freshIdNumber());
      await review(admin, submission.rows[0].id, "rejected");
      const productId = await makeProduct(seller, "Sell Gate Toy F");
      await db.query("reset role");
      await asUser(db, seller, async () => {
        await expect(
          db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
        ).rejects.toThrow(/account verification required/i);
      });
    });

    it("re-publishing after an archive still requires verification", async () => {
      const seller = await makeUser(db, "Sell Gate Reactivate Seller", { verified: false });
      const productId = await makeProduct(seller, "Sell Gate Reactivate Toy", { status: "archived" });
      await asUser(db, seller, async () => {
        await db.query(`update public.products set status = 'draft' where id = $1`, [productId]);
        await expect(
          db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
        ).rejects.toThrow(/account verification required/i);
      });
    });

    it("raw fixture/test setup (not running as the authenticated role) is exempt — this is what every other test file's makeProduct(status:'published') already relies on", async () => {
      const seller = await makeUser(db, "Fixture Exempt Seller", { verified: false });
      await db.query("reset role");
      const productId = await makeProduct(seller, "Fixture Exempt Toy", { status: "published" });
      const check = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(check.rows[0].status).toBe("published");
    });

    it("another user cannot publish someone else's listing — RLS ownership and the verification trigger are independent, additive gates", async () => {
      const owner = await makeUser(db, "Publish Ownership Owner");
      const stranger = await makeUser(db, "Publish Ownership Stranger"); // also fully verified — proves this is an ownership, not verification, rejection
      const productId = await makeProduct(owner, "Publish Ownership Toy");
      const r = await asUser(db, stranger, () =>
        db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId]),
      );
      // RLS's products_update_owner_or_admin policy filters the row out
      // entirely for a non-owner — a silent 0-row match, not a thrown
      // exception (the trigger never even fires, since no row matches).
      expect(r.affectedRows).toBe(0);
      await db.query("reset role");
      const check = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(check.rows[0].status).toBe("draft");
    });
  });

  describe("security review of enforce_seller_verification_on_publish() (current_user semantics)", () => {
    it("current_user inside a SECURITY DEFINER function reports the function owner, not the invoking role — this is exactly why the trigger checks current_user, and exactly why it can be silently exempted from inside one", async () => {
      await db.query(`
        create function public.__test_probe_current_user() returns text
        language plpgsql security definer set search_path = public as $$
        begin return current_user; end;
        $$;
      `);
      const user = await makeUser(db, "Current User Probe");
      const insideDefiner = await asUser(db, user, () => db.query<{ __test_probe_current_user: string }>(`select public.__test_probe_current_user()`));
      expect(insideDefiner.rows[0].__test_probe_current_user).toBe("postgres");

      const plainStatement = await asUser(db, user, () => db.query<{ current_user: string }>(`select current_user`));
      expect(plainStatement.rows[0].current_user).toBe("authenticated");
    });

    it("CONFIRMED AND FIXED: decline_cash_order() no longer republishes a listing for a seller whose verification has since lapsed", async () => {
      const seller = await makeUser(db, "Decline Lapse Seller"); // fully verified when the order is created
      await db.query(`update public.profiles set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Decline Lapse Buyer");
      const productId = await makeProduct(seller, "Decline Lapse Toy", { status: "published" });
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));

      // Seller's verification lapses AFTER the order exists — a fresh
      // resubmission flips profiles.identity_verification back to
      // 'pending' (see the sync trigger).
      await asUser(db, seller, () =>
        db.query(
          `insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number) values ($1, 'manual', 'sa_id', 'x', $2)`,
          [seller, freshIdNumber()],
        ),
      );
      await db.query("reset role");
      const nowUnverified = await asUser(db, seller, () => db.query<{ can_transact: boolean }>(`select public.can_transact()`));
      expect(nowUnverified.rows[0].can_transact).toBe(false);

      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1)`, [created.rows[0].order_id]));

      await db.query("reset role");
      const product = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      // Before the fix this was 'published' — republished with no fresh
      // check, bypassing enforce_seller_verification_on_publish() via
      // decline_cash_order()'s own SECURITY DEFINER context. Now: safe,
      // not purchasable, and not itself blocking the decline/cancellation.
      expect(product.rows[0].status).toBe("draft");

      const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [created.rows[0].order_id]);
      expect(order.rows[0].status).toBe("cancelled");
    });

    it("decline_cash_order() still republishes normally for a seller who remains fully verified (no regression to the ordinary case)", async () => {
      const seller = await makeUser(db, "Decline Still Verified Seller");
      await db.query(`update public.profiles set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`, [seller]);
      const buyer = await makeUser(db, "Decline Still Verified Buyer");
      const productId = await makeProduct(seller, "Decline Still Verified Toy", { status: "published" });
      const created = await asUser(db, buyer, () => db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));

      await asUser(db, seller, () => db.query(`select public.decline_cash_order($1)`, [created.rows[0].order_id]));

      await db.query("reset role");
      const product = await db.query<{ status: string }>(`select status from public.products where id = $1`, [productId]);
      expect(product.rows[0].status).toBe("published");
    });
  });

  describe("security", () => {
    it("22. a user cannot modify their own identity_verification status directly on profiles", async () => {
      const user = await makeUser(db, "No Self Status A", { verified: false });
      await asUser(db, user, async () => {
        await expect(db.query(`update public.profiles set identity_verification = 'verified' where id = $1`, [user])).rejects.toThrow(
          /permission denied/i,
        );
      });
    });

    it("23. a user cannot modify another user's verification status", async () => {
      const user = await makeUser(db, "No Other Status A", { verified: false });
      const other = await makeUser(db, "No Other Status Target", { verified: false });
      const submission = await submitIdentity(other, freshIdNumber());
      await asUser(db, user, async () => {
        await expect(db.query(`select public.review_identity_verification($1, 'verified', null)`, [submission.rows[0].id])).rejects.toThrow(
          /admin authorization required/i,
        );
      });
      await db.query("reset role");
      const row = await db.query<{ status: string }>(`select status from public.identity_verifications where id = $1`, [submission.rows[0].id]);
      expect(row.rows[0].status).toBe("pending");
    });

    it("24. a user cannot read another user's identity document path", async () => {
      const owner = await makeUser(db, "Doc Owner A", { verified: false });
      const stranger = await makeUser(db, "Doc Stranger A", { verified: false });
      await submitIdentity(owner, freshIdNumber());
      const r = await asUser(db, stranger, () => db.query(`select document_storage_path from public.identity_verifications where profile_id = $1`, [owner]));
      expect(r.rows).toHaveLength(0);
    });

    it("25. a user cannot read another user's ID number", async () => {
      const owner = await makeUser(db, "IdNum Owner A", { verified: false });
      const stranger = await makeUser(db, "IdNum Stranger A", { verified: false });
      await submitIdentity(owner, freshIdNumber());
      const r = await asUser(db, stranger, () => db.query(`select id_number from public.identity_verifications where profile_id = $1`, [owner]));
      expect(r.rows).toHaveLength(0);
    });

    it("the owner CAN read their own id_number and document path (row-level, not a leak)", async () => {
      const owner = await makeUser(db, "IdNum Self Read A", { verified: false });
      const idNumber = freshIdNumber();
      await submitIdentity(owner, idNumber);
      const r = await asUser(db, owner, () => db.query<{ id_number: string }>(`select id_number from public.identity_verifications where profile_id = $1`, [owner]));
      expect(r.rows[0].id_number).toBe(idNumber);
    });

    it("26. a non-admin cannot approve an identity verification", async () => {
      const user = await makeUser(db, "Non Admin Approve A", { verified: false });
      const nonAdmin = await makeUser(db, "Non Admin Approve B");
      const submission = await submitIdentity(user, freshIdNumber());
      await asUser(db, nonAdmin, async () => {
        await expect(db.query(`select public.review_identity_verification($1, 'verified', null)`, [submission.rows[0].id])).rejects.toThrow(
          /admin authorization required/i,
        );
      });
    });

    it("27. a non-admin cannot reject an identity verification", async () => {
      const user = await makeUser(db, "Non Admin Reject A", { verified: false });
      const nonAdmin = await makeUser(db, "Non Admin Reject B");
      const submission = await submitIdentity(user, freshIdNumber());
      await asUser(db, nonAdmin, async () => {
        await expect(db.query(`select public.review_identity_verification($1, 'rejected', null)`, [submission.rows[0].id])).rejects.toThrow(
          /admin authorization required/i,
        );
      });
    });

    it("28. duplicate verified identity is prevented — approving a second submission with an already-verified ID number fails", async () => {
      const userA = await makeUser(db, "Dup Id A", { verified: false });
      const userB = await makeUser(db, "Dup Id B", { verified: false });
      const admin = await makeAdmin(db, "Dup Id Admin");
      const sharedIdNumber = freshIdNumber();

      const subA = await submitIdentity(userA, sharedIdNumber);
      await review(admin, subA.rows[0].id, "verified");

      const subB = await submitIdentity(userB, sharedIdNumber);
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.review_identity_verification($1, 'verified', null)`, [subB.rows[0].id])).rejects.toThrow(
          /already verified on a different account/i,
        );
      });

      await db.query("reset role");
      const rowB = await db.query<{ status: string }>(`select status from public.identity_verifications where id = $1`, [subB.rows[0].id]);
      expect(rowB.rows[0].status).toBe("pending"); // rejected attempt did not partially apply
    });

    it("the same user CAN resubmit their own ID number again after a rejection (not blocked as a duplicate)", async () => {
      const user = await makeUser(db, "Self Resubmit Same Id", { verified: false });
      const admin = await makeAdmin(db, "Self Resubmit Admin");
      const idNumber = freshIdNumber();
      const first = await submitIdentity(user, idNumber);
      await review(admin, first.rows[0].id, "rejected");
      const second = await submitIdentity(user, idNumber);
      await review(admin, second.rows[0].id, "verified");
      await db.query("reset role");
      const row = await db.query<{ status: string }>(`select status from public.identity_verifications where id = $1`, [second.rows[0].id]);
      expect(row.rows[0].status).toBe("verified");
    });

    it("admin cannot re-review an already-decided submission", async () => {
      const user = await makeUser(db, "No Re Review A", { verified: false });
      const admin = await makeAdmin(db, "No Re Review Admin");
      const submission = await submitIdentity(user, freshIdNumber());
      await review(admin, submission.rows[0].id, "verified");
      await asUser(db, admin, async () => {
        await expect(db.query(`select public.review_identity_verification($1, 'rejected', null)`, [submission.rows[0].id])).rejects.toThrow(
          /already been reviewed/i,
        );
      });
    });

    it("29. raw ID number does not appear in profiles_public", async () => {
      const cols = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles_public'`,
      );
      expect(cols.rows.map((c) => c.column_name)).not.toContain("id_number");
    });

    it("approving/rejecting records an admin_actions row with the actor and target", async () => {
      const user = await makeUser(db, "Admin Action Log A", { verified: false });
      const admin = await makeAdmin(db, "Admin Action Log Admin");
      const submission = await submitIdentity(user, freshIdNumber());
      await review(admin, submission.rows[0].id, "verified", "looks good");
      await db.query("reset role");
      const action = await db.query<{ admin_id: string; action_type: string; target_id: string }>(
        `select admin_id, action_type, target_id from public.admin_actions where target_id = $1`,
        [submission.rows[0].id],
      );
      expect(action.rows[0]).toEqual({
        admin_id: admin,
        action_type: "identity_verification_verified",
        target_id: submission.rows[0].id,
      });
    });

    it("SECURITY DEFINER functions use a safe search_path — spot-checked against pg_proc", async () => {
      const r = await db.query<{ proname: string; proconfig: string[] | null }>(
        `select proname, proconfig from pg_proc
         where proname in ('can_transact', 'is_profile_fully_verified', 'review_identity_verification', 'sync_profile_identity_verification', 'latest_identity_verification_status')`,
      );
      expect(r.rows).toHaveLength(5);
      for (const row of r.rows) {
        expect(row.proconfig).toContain("search_path=public");
      }
    });
  });

  describe("storage: verification-documents", () => {
    it("user can upload (INSERT into storage.objects) under their own path", async () => {
      const user = await makeUser(db, "Storage Own Upload A", { verified: false });
      const r = await asUser(db, user, () =>
        db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [
          `${user}/${crypto.randomUUID()}/id-document.jpg`,
          user,
        ]),
      );
      expect(r.affectedRows).toBe(1);
    });

    it("user cannot upload into another user's path", async () => {
      const user = await makeUser(db, "Storage No Cross Upload A", { verified: false });
      const other = await makeUser(db, "Storage No Cross Upload B", { verified: false });
      await asUser(db, user, async () => {
        await expect(
          db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [
            `${other}/${crypto.randomUUID()}/id-document.jpg`,
            user,
          ]),
        ).rejects.toThrow();
      });
    });

    it("user cannot read another user's document", async () => {
      const owner = await makeUser(db, "Storage No Cross Read A", { verified: false });
      const stranger = await makeUser(db, "Storage No Cross Read B", { verified: false });
      const path = `${owner}/${crypto.randomUUID()}/id-document.jpg`;
      await asUser(db, owner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, owner]));
      const r = await asUser(db, stranger, () => db.query(`select * from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(r.rows).toHaveLength(0);
    });

    it("admin can read any user's document", async () => {
      const owner = await makeUser(db, "Storage Admin Read A", { verified: false });
      const admin = await makeAdmin(db, "Storage Admin Read Admin");
      const path = `${owner}/${crypto.randomUUID()}/id-document.jpg`;
      await asUser(db, owner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, owner]));
      const r = await asUser(db, admin, () => db.query(`select * from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]));
      expect(r.rows).toHaveLength(1);
    });

    it("anonymous cannot read any verification document", async () => {
      const owner = await makeUser(db, "Storage Anon Read A", { verified: false });
      const path = `${owner}/${crypto.randomUUID()}/id-document.jpg`;
      await asUser(db, owner, () => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('verification-documents', $1, $2)`, [path, owner]));
      await asAnon(db, async () => {
        const r = await db.query(`select * from storage.objects where bucket_id = 'verification-documents' and name = $1`, [path]);
        expect(r.rows).toHaveLength(0);
      });
    });
  });

  describe("cash interaction with the new global gate", () => {
    async function makeCashEligibleSeller(name: string): Promise<string> {
      // Fully verified (makeUser default) plus the rest of Phase 4C's own criteria.
      const id = await makeUser(db, name);
      await db.query(
        `update public.profiles set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`,
        [id],
      );
      return id;
    }

    it("30. a fully verified seller still must satisfy Phase 4C's own cash eligibility criteria", async () => {
      const seller = await makeUser(db, "Cash Verified Not Eligible Seller"); // verified, but no completed transactions/rating
      const buyer = await makeUser(db, "Cash Verified Not Eligible Buyer");
      const productId = await makeProduct(seller, "Cash Verified Toy", { status: "published" });
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("31. an unverified seller cannot use cash selling even if the rest of Phase 4C's criteria would otherwise pass", async () => {
      const seller = await makeUser(db, "Cash Unverified Seller", { verified: false });
      await db.query(
        `update public.profiles set completed_transaction_count = 5, rating_average = 4.5, account_standing = 'good' where id = $1`,
        [seller],
      );
      const buyer = await makeUser(db, "Cash Unverified Buyer");
      const productId = await asUser(db, seller, () =>
        // Draft creation is allowed for an unverified seller; publish must go through the raw exemption path for this test's setup.
        db.query<{ id: string }>(
          `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
           values ('parent', $1, $2, 'Cash Unverified Toy', 'good', 50000, 'draft', true, true) returning id`,
          [seller, categoryId],
        ),
      );
      await db.query("reset role");
      await db.query(`update public.products set status = 'published' where id = $1`, [productId.rows[0].id]);
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId.rows[0].id])).rejects.toThrow(
          /not currently eligible/i,
        );
      });
    });

    it("32. the existing cash kill switch remains authoritative regardless of verification", async () => {
      const seller = await makeCashEligibleSeller("Cash Killswitch Seller");
      const buyer = await makeUser(db, "Cash Killswitch Buyer");
      const productId = await makeProduct(seller, "Cash Killswitch Toy", { status: "published" });
      await db.query(`update public.cash_settings set is_enabled = false where id = true`);
      try {
        await asUser(db, buyer, async () => {
          await expect(db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId])).rejects.toThrow(
            /currently unavailable/i,
          );
        });
      } finally {
        await db.query(`update public.cash_settings set is_enabled = true where id = true`);
      }
    });

    it("33. cash + delivery remains rejected regardless of verification", async () => {
      const seller = await makeCashEligibleSeller("Cash Delivery Reject Seller");
      const buyer = await makeUser(db, "Cash Delivery Reject Buyer");
      const productId = await makeProduct(seller, "Cash Delivery Reject Toy", { status: "published" });
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'delivery', 'cash')`, [productId])).rejects.toThrow(
          /not available for delivery/i,
        );
      });
    });

    it("a fully verified, fully eligible seller CAN sell for cash (positive end-to-end path)", async () => {
      const seller = await makeCashEligibleSeller("Cash Full Success Seller");
      const buyer = await makeUser(db, "Cash Full Success Buyer");
      const productId = await makeProduct(seller, "Cash Full Success Toy", { status: "published" });
      const r = await asUser(db, buyer, () => db.query(`select * from public.create_order($1, 'collection', 'cash')`, [productId]));
      expect(r.rows).toHaveLength(1);
    });
  });

  describe("regression", () => {
    it("34. browsing (reading published products) remains available to an unverified, even anonymous, user", async () => {
      const seller = await makeUser(db, "Regression Browse Seller");
      await makeProduct(seller, "Regression Browse Toy", { status: "published" });
      await asAnon(db, async () => {
        const r = await db.query(`select id from public.products where status = 'published' and title = 'Regression Browse Toy'`);
        expect(r.rows).toHaveLength(1);
      });
    });

    it("35. search_products() remains available to an unverified user", async () => {
      const seller = await makeUser(db, "Regression Search Seller");
      await makeProduct(seller, "Regression Search Toy Unique", { status: "published" });
      const unverified = await makeUser(db, "Regression Search Buyer", { verified: false });
      const r = await asUser(db, unverified, () =>
        db.query(`select * from public.search_products($1)`, ["Regression Search Toy Unique"]),
      );
      expect(r.rows.length).toBeGreaterThan(0);
    });

    it("36. viewing a single product page (reading one published product) remains available to an unverified user", async () => {
      const seller = await makeUser(db, "Regression View Seller");
      const productId = await makeProduct(seller, "Regression View Toy", { status: "published" });
      const unverified = await makeUser(db, "Regression View Buyer", { verified: false });
      const r = await asUser(db, unverified, () => db.query(`select id from public.products where id = $1`, [productId]));
      expect(r.rows).toHaveLength(1);
    });
  });
});
