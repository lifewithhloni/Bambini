import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asServiceRole, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 15A.1 — phone verification foundation, against the real migration
 * SQL on real Postgres (PGlite), same method as every tests/db file.
 *
 * What is and isn't testable here: this harness stands in for Supabase
 * Auth with a minimal auth.users table, so these tests prove the DATABASE
 * side — that phone_confirmed_at is the only thing can_transact() trusts,
 * that profiles.phone is inert, and that the abuse-protection throttle
 * behaves and is unreachable by client roles. They do NOT exercise GoTrue
 * (updateUser / verifyOtp / SMS delivery); that flow is covered by mocked
 * unit tests in src/server/phone/actions.test.ts and, for a real number,
 * only by manual verification once a provider is connected.
 */
describe("phone verification foundation", () => {
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

  async function canTransact(userId: string): Promise<boolean> {
    const r = await asUser(db, userId, () => db.query<{ can_transact: boolean }>(`select public.can_transact()`));
    return r.rows[0].can_transact;
  }

  async function makeProduct(seller: string, title: string, status: "draft" | "published" = "draft") {
    const r = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status, collection_available, delivery_available)
       values ('parent', $1, $2, $3, 'good', 50000, $4, true, true) returning id`,
      [seller, categoryId, title, status],
    );
    return r.rows[0].id;
  }

  /** Seeds a LEGACY profiles.phone value as the table owner — what pre-existing data looks like; clients can no longer write it. */
  async function seedLegacyProfilePhone(userId: string, phone: string | null) {
    await db.query("reset role");
    await db.query(`update public.profiles set phone = $2 where id = $1`, [userId, phone]);
  }

  describe("profiles.phone: no client write access (legacy, non-authoritative)", () => {
    it("an authenticated user cannot UPDATE profiles.phone — column privilege revoked", async () => {
      const user = await makeUser(db, "No Client Phone Update");
      await asUser(db, user, async () => {
        await expect(db.query(`update public.profiles set phone = '+27821234567' where id = $1`, [user])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`update public.profiles set phone = null where id = $1`, [user])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`update public.profiles set full_name = 'Renamed', phone = '0821234567' where id = $1`, [user])).rejects.toThrow(/permission denied/i);
      });
      const r = await db.query<{ phone: string | null }>(`select phone from public.profiles where id = $1`, [user]);
      expect(r.rows[0].phone).toBeNull();
    });

    it("an authenticated user cannot INSERT a profile row carrying a phone", async () => {
      // A signed-in user with no profile row yet (auth row without the trigger's profile removed) is the only way to reach INSERT.
      const user = await makeUser(db, "No Client Phone Insert");
      await db.query("reset role");
      await db.query(`delete from public.profiles where id = $1`, [user]);
      await asUser(db, user, async () => {
        await expect(db.query(`insert into public.profiles (id, full_name, phone) values ($1, 'X', '+27821234567')`, [user])).rejects.toThrow(/permission denied/i);
        await expect(db.query(`insert into public.profiles (id, full_name, phone) values ($1, 'X', null)`, [user])).rejects.toThrow(/permission denied/i);
        // The columns clients ARE meant to set on insert still work.
        const ok = await db.query(`insert into public.profiles (id, full_name) values ($1, 'Ok Name')`, [user]);
        expect(ok.affectedRows).toBe(1);
      });
    });

    it("anon cannot write profiles.phone either", async () => {
      const user = await makeUser(db, "No Anon Phone Update");
      await asAnon(db, async () => {
        const r = await db.query(`update public.profiles set phone = '+27821234567' where id = $1`, [user]).catch(() => null);
        expect(r === null || r.affectedRows === 0).toBe(true);
      });
      const check = await db.query<{ phone: string | null }>(`select phone from public.profiles where id = $1`, [user]);
      expect(check.rows[0].phone).toBeNull();
    });

    it("the other client-writable profile columns still work (full_name, location_id, avatar_url)", async () => {
      const user = await makeUser(db, "Other Columns Still Work");
      const r = await asUser(db, user, () =>
        db.query(`update public.profiles set full_name = 'New Name', avatar_url = 'https://example.com/a.png' where id = $1`, [user]),
      );
      expect(r.affectedRows).toBe(1);
    });

    it("existing stored legacy values are preserved and still readable by their owner", async () => {
      const user = await makeUser(db, "Legacy Phone Kept");
      await seedLegacyProfilePhone(user, "0821234567");
      const r = await asUser(db, user, () => db.query<{ phone: string }>(`select phone from public.profiles where id = $1`, [user]));
      expect(r.rows[0].phone).toBe("0821234567");
    });

    it("the owner/service path (not a client role) can still maintain the column — nothing was altered for postgres/service_role", async () => {
      const user = await makeUser(db, "Service Phone Write");
      const r = await asServiceRole(db, () => db.query(`update public.profiles set phone = '0831234567' where id = $1`, [user]));
      expect(r.affectedRows).toBe(1);
    });
  });

  describe("profiles.phone is NOT proof of verification", () => {
    it("a legacy profiles.phone value that looks real still doesn't make a user eligible without auth.users.phone_confirmed_at", async () => {
      const user = await makeUser(db, "Profile Phone Only");
      await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [user]);
      await seedLegacyProfilePhone(user, "+27821234567");
      const stored = await db.query<{ phone: string }>(`select phone from public.profiles where id = $1`, [user]);
      expect(stored.rows[0].phone).toBe("+27821234567");

      expect(await canTransact(user)).toBe(false);
    });

    it("setting or clearing profiles.phone never changes eligibility for a user whose Auth phone IS confirmed", async () => {
      const user = await makeUser(db, "Profile Phone Edit Verified");
      expect(await canTransact(user)).toBe(true);

      await seedLegacyProfilePhone(user, "0839999999");
      expect(await canTransact(user)).toBe(true);

      await seedLegacyProfilePhone(user, null);
      expect(await canTransact(user)).toBe(true);
    });

    it("is documented as non-authoritative on the column itself", async () => {
      const r = await db.query<{ comment: string }>(
        `select col_description('public.profiles'::regclass, (select attnum from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'phone')) as comment`,
      );
      expect(r.rows[0].comment).toMatch(/NON-AUTHORITATIVE/);
      expect(r.rows[0].comment).toMatch(/phone_confirmed_at/);
    });
  });

  describe("auth.users.phone_confirmed_at is authoritative", () => {
    it("a number on auth.users WITHOUT phone_confirmed_at does not make a user eligible", async () => {
      const user = await makeUser(db, "Auth Phone Unconfirmed");
      await db.query(`update auth.users set phone = '27821234567', phone_confirmed_at = null where id = $1`, [user]);
      expect(await canTransact(user)).toBe(false);
    });

    it("a confirmed phone satisfies the phone component of can_transact() (with email + identity also verified)", async () => {
      const user = await makeUser(db, "Auth Phone Confirmed");
      await db.query(`update auth.users set phone = '27821234567' where id = $1`, [user]);
      expect(await canTransact(user)).toBe(true);
    });

    it("the phone requirement is independent of the other two: confirmed phone alone is not enough", async () => {
      const noEmail = await makeUser(db, "Phone Ok Email Not");
      await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [noEmail]);
      expect(await canTransact(noEmail)).toBe(false);

      const noIdentity = await makeUser(db, "Phone Ok Identity Not", { verified: false });
      await db.query(`update auth.users set email_confirmed_at = now(), phone_confirmed_at = now() where id = $1`, [noIdentity]);
      expect(await canTransact(noIdentity)).toBe(false);
    });

    it("changing the phone requires re-verification: a new Auth number without a fresh confirmation is ineligible until confirmed", async () => {
      const user = await makeUser(db, "Phone Change Reverify");
      await db.query(`update auth.users set phone = '27821234567' where id = $1`, [user]);
      expect(await canTransact(user)).toBe(true);

      // What Auth does when a number is swapped without a completed OTP check: confirmation is cleared.
      await db.query(`update auth.users set phone = '27839999999', phone_confirmed_at = null where id = $1`, [user]);
      expect(await canTransact(user)).toBe(false);

      // Only the OTP completing (Auth setting phone_confirmed_at) restores it.
      await db.query(`update auth.users set phone_confirmed_at = now() where id = $1`, [user]);
      expect(await canTransact(user)).toBe(true);
    });

    it("a client cannot reach auth.users to set phone_confirmed_at themselves", async () => {
      const user = await makeUser(db, "No Self Confirm Phone", { verified: false });
      await asUser(db, user, async () => {
        await expect(db.query(`update auth.users set phone_confirmed_at = now() where id = $1`, [user])).rejects.toThrow(/permission denied/i);
      });
      // …and no profiles column can carry it either.
      await asUser(db, user, async () => {
        await expect(db.query(`update public.profiles set phone_confirmed_at = now() where id = $1`, [user])).rejects.toThrow();
      });
    });
  });

  describe("transaction gates still require the confirmed phone", () => {
    it("unverified phone cannot publish a listing", async () => {
      const seller = await makeUser(db, "Phone Gate Seller A");
      await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [seller]);
      await seedLegacyProfilePhone(seller, "+27821234567"); // a profile phone is irrelevant to the gate
      const productId = await makeProduct(seller, "Phone Gate Toy A");
      await asUser(db, seller, async () => {
        await expect(db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [productId])).rejects.toThrow(
          /account verification required/i,
        );
      });
    });

    it("unverified phone cannot buy", async () => {
      const seller = await makeUser(db, "Phone Gate Seller B");
      const buyer = await makeUser(db, "Phone Gate Buyer B");
      await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [buyer]);
      await seedLegacyProfilePhone(buyer, "+27821234567");
      const productId = await makeProduct(seller, "Phone Gate Toy B", "published");
      await asUser(db, buyer, async () => {
        await expect(db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId])).rejects.toThrow(/account verification required/i);
      });
    });

    it("a confirmed phone lets the same user buy and publish", async () => {
      const seller = await makeUser(db, "Phone Gate Seller C");
      const buyer = await makeUser(db, "Phone Gate Buyer C");
      const draft = await makeProduct(seller, "Phone Gate Toy C draft");
      const pub = await asUser(db, seller, () => db.query(`update public.products set status = 'published', published_at = now() where id = $1`, [draft]));
      expect(pub.affectedRows).toBe(1);
      const productId = await makeProduct(seller, "Phone Gate Toy C", "published");
      const order = await asUser(db, buyer, () => db.query(`select * from public.create_order($1, 'collection', 'online')`, [productId]));
      expect(order.rows).toHaveLength(1);
    });

    it("browsing and favourites do not require phone verification (the gate is only buy/publish)", async () => {
      const seller = await makeUser(db, "Phone Free Seller");
      const visitor = await makeUser(db, "Phone Free Visitor", { verified: false });
      const productId = await makeProduct(seller, "Phone Free Toy", "published");

      const browse = await asUser(db, visitor, () => db.query(`select id from public.products where id = $1`, [productId]));
      expect(browse.rows).toHaveLength(1);

      const fav = await asUser(db, visitor, () => db.query(`insert into public.product_favourites (profile_id, product_id) values ($1, $2)`, [visitor, productId]));
      expect(fav.affectedRows).toBe(1);
    });
  });

  describe("phone_verification_throttle — access control", () => {
    it("RLS is on and no client role can read, write or clear the throttle table", async () => {
      const user = await makeUser(db, "Throttle Table Snoop");
      await asServiceRole(db, () => db.query(`select * from public.phone_throttle_hit('user:x', 'send', 5, 3600, 0, true)`));

      await asUser(db, user, async () => {
        await expect(db.query(`select * from public.phone_verification_throttle`)).rejects.toThrow(/permission denied/i);
        await expect(db.query(`delete from public.phone_verification_throttle`)).rejects.toThrow(/permission denied/i);
        await expect(db.query(`insert into public.phone_verification_throttle (subject, action) values ('user:x', 'send')`)).rejects.toThrow(/permission denied/i);
      });
      await asAnon(db, async () => {
        await expect(db.query(`select * from public.phone_verification_throttle`)).rejects.toThrow(/permission denied/i);
      });

      const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = 'public.phone_verification_throttle'::regclass`);
      expect(rls.rows[0].relrowsecurity).toBe(true);
    });

    it("only service_role may call the throttle functions — a signed-in user can't reset their own counters", async () => {
      const user = await makeUser(db, "Throttle Fn Snoop");
      await asUser(db, user, async () => {
        await expect(db.query(`select * from public.phone_throttle_hit('user:me', 'send', 5, 3600, 0, true)`)).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select public.phone_throttle_reset('user:me', 'send')`)).rejects.toThrow(/permission denied/i);
      });
      await asAnon(db, async () => {
        await expect(db.query(`select * from public.phone_throttle_hit('user:me', 'send', 5, 3600, 0, true)`)).rejects.toThrow(/permission denied/i);
      });
    });

    it("stores no phone number or code — only subject, action and a timestamp", async () => {
      const cols = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'phone_verification_throttle' order by ordinal_position`,
      );
      expect(cols.rows.map((c) => c.column_name)).toEqual(["id", "subject", "action", "created_at"]);
    });
  });

  describe("phone_throttle_hit — behaviour", () => {
    const hit = (subject: string, action: "send" | "verify", max: number, windowS: number, cooldown = 0, record = true) =>
      asServiceRole(db, () =>
        db.query<{ allowed: boolean; retry_after_seconds: number }>(`select * from public.phone_throttle_hit($1, $2, $3, $4, $5, $6)`, [
          subject,
          action,
          max,
          windowS,
          cooldown,
          record,
        ]),
      ).then((r) => r.rows[0]);

    it("resend cooldown: a second send inside the cooldown is refused with a sensible wait", async () => {
      expect(await hit("user:cooldown", "send", 5, 3600, 60)).toEqual({ allowed: true, retry_after_seconds: 0 });
      const second = await hit("user:cooldown", "send", 5, 3600, 60);
      expect(second.allowed).toBe(false);
      expect(second.retry_after_seconds).toBeGreaterThan(55);
      expect(second.retry_after_seconds).toBeLessThanOrEqual(60);
    });

    it("the cooldown clears once enough time has passed", async () => {
      await hit("user:cooldown-expiry", "send", 5, 3600, 60);
      await db.query(`update public.phone_verification_throttle set created_at = now() - interval '61 seconds' where subject = 'user:cooldown-expiry'`);
      expect((await hit("user:cooldown-expiry", "send", 5, 3600, 60)).allowed).toBe(true);
    });

    it("throttling: exactly max attempts are allowed inside the window, the next is refused with a retry time", async () => {
      for (let i = 0; i < 5; i++) expect((await hit("user:window", "verify", 5, 900)).allowed).toBe(true);
      const sixth = await hit("user:window", "verify", 5, 900);
      expect(sixth.allowed).toBe(false);
      expect(sixth.retry_after_seconds).toBeGreaterThan(890);
      expect(sixth.retry_after_seconds).toBeLessThanOrEqual(900);
    });

    it("attempts age out of the window", async () => {
      for (let i = 0; i < 3; i++) await hit("user:aging", "verify", 3, 900);
      expect((await hit("user:aging", "verify", 3, 900)).allowed).toBe(false);
      await db.query(`update public.phone_verification_throttle set created_at = now() - interval '901 seconds' where subject = 'user:aging'`);
      expect((await hit("user:aging", "verify", 3, 900)).allowed).toBe(true);
    });

    it("a refused attempt is not recorded (a locked-out user doesn't extend their own lockout)", async () => {
      for (let i = 0; i < 2; i++) await hit("user:norecord", "verify", 2, 900);
      await hit("user:norecord", "verify", 2, 900);
      await hit("user:norecord", "verify", 2, 900);
      const n = await db.query<{ n: number }>(`select count(*)::int as n from public.phone_verification_throttle where subject = 'user:norecord'`);
      expect(n.rows[0].n).toBe(2);
    });

    it("a peek (p_record = false) reports the state without consuming an attempt", async () => {
      await hit("user:peek", "send", 5, 3600, 60);
      expect((await hit("user:peek", "send", 5, 3600, 60, false)).allowed).toBe(false);
      expect((await hit("user:peek-fresh", "send", 5, 3600, 60, false)).allowed).toBe(true);
      const n = await db.query<{ n: number }>(`select count(*)::int as n from public.phone_verification_throttle where subject in ('user:peek','user:peek-fresh')`);
      expect(n.rows[0].n).toBe(1);
    });

    it("subjects and actions are independent counters", async () => {
      for (let i = 0; i < 2; i++) await hit("user:indep-a", "verify", 2, 900);
      expect((await hit("user:indep-a", "verify", 2, 900)).allowed).toBe(false);
      expect((await hit("user:indep-b", "verify", 2, 900)).allowed).toBe(true); // other user
      expect((await hit("user:indep-a", "send", 2, 900)).allowed).toBe(true); // other action
    });

    it("reset clears one subject's counter for one action only (used after a successful verification)", async () => {
      for (let i = 0; i < 2; i++) await hit("user:reset", "verify", 2, 900);
      await hit("user:reset", "send", 5, 900);
      await asServiceRole(db, () => db.query(`select public.phone_throttle_reset('user:reset', 'verify')`));
      expect((await hit("user:reset", "verify", 2, 900)).allowed).toBe(true);
      const sends = await db.query<{ n: number }>(`select count(*)::int as n from public.phone_verification_throttle where subject = 'user:reset' and action = 'send'`);
      expect(sends.rows[0].n).toBe(1);
    });

    it("concurrent attempts for the same subject can't slip past the limit", async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => hit("user:race", "verify", 3, 900)));
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
      expect(results.filter((r) => !r.allowed)).toHaveLength(7);
    });

    it("rejects an unknown action and nonsensical parameters", async () => {
      await asServiceRole(db, async () => {
        await expect(db.query(`select * from public.phone_throttle_hit('user:x', 'bogus', 5, 3600, 0, true)`)).rejects.toThrow(/invalid action/i);
        await expect(db.query(`select * from public.phone_throttle_hit('user:x', 'send', 0, 3600, 0, true)`)).rejects.toThrow(/invalid throttle parameters/i);
      });
      await expect(db.query(`insert into public.phone_verification_throttle (subject, action) values ('user:x', 'other')`)).rejects.toThrow();
    });
  });
});
