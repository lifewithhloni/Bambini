import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, bootAndMigrate, makeUser } from "./harness";

/**
 * Phase 4B: record_payment_attempt() and process_payfast_itn() —
 * exercised against the real migration SQL and real Postgres, the same
 * method as every other tests/db/*.test.ts file. PayFast's own protocol
 * verification (signature, host, query/validate) is unit-tested in
 * src/server/payments/providers/payfast/*.test.ts against fixtures —
 * these tests cover what happens *after* that verification succeeds:
 * the atomic, idempotent, state-machine-safe database mutation.
 */
describe("PayFast payment DB functions", () => {
  let db: PGlite;
  let alice: string; // seller
  let bob: string; // buyer
  let carol: string; // unrelated user
  let categoryId: string;

  async function makeOrder(seller: string, buyer: string, priceCents = 50000) {
    const cat = categoryId;
    const product = await db.query<{ id: string }>(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
       values ('parent', $1, $2, 'PayFast Test Item', 'good', $3, 'published') returning id`,
      [seller, cat, priceCents],
    );
    const created = await asUser(db, buyer, () =>
      db.query<{ order_id: string; order_reference: string }>(`select * from public.create_order($1, 'collection')`, [
        product.rows[0].id,
      ]),
    );
    return created.rows[0];
  }

  beforeAll(async () => {
    db = await bootAndMigrate();
    await db.query("reset role");

    alice = await makeUser(db, "PayFast Alice");
    bob = await makeUser(db, "PayFast Bob");
    carol = await makeUser(db, "PayFast Carol");

    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    categoryId = cat.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("payment_providers seed", () => {
    it("payfast is seeded but not active by default — orders still attach to mock until an operator flips is_active", async () => {
      await db.query("reset role");
      const r = await db.query<{ slug: string; is_active: boolean }>(
        `select slug, is_active from public.payment_providers where slug = 'payfast'`,
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].is_active).toBe(false);
    });
  });

  describe("record_payment_attempt() — authentication and authorization", () => {
    it("1. unauthenticated user cannot initiate payment", async () => {
      const order = await makeOrder(alice, bob);
      await asAnon(db, async () => {
        await expect(db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-1"])).rejects.toThrow();
      });
    });

    it("2. buyer can initiate payment for their own order", async () => {
      const order = await makeOrder(alice, bob);
      await asUser(db, bob, () => db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-2"]));
      await db.query("reset role");
      const payment = await db.query<{ status: string; provider_reference: string }>(
        `select status, provider_reference from public.payments where order_id = $1`,
        [order.order_id],
      );
      expect(payment.rows[0].status).toBe("pending");
      expect(payment.rows[0].provider_reference).toBe("ref-2");
    });

    it("3. buyer cannot initiate payment for another user's order", async () => {
      const order = await makeOrder(alice, bob);
      await asUser(db, carol, async () => {
        await expect(
          db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-3"]),
        ).rejects.toThrow(/not found/i);
      });
      await db.query("reset role");
      const payment = await db.query<{ provider_reference: string | null }>(
        `select provider_reference from public.payments where order_id = $1`,
        [order.order_id],
      );
      expect(payment.rows[0].provider_reference).toBeNull();
    });

    it("records a payment.initiated transaction event, actor buyer", async () => {
      const order = await makeOrder(alice, bob);
      await asUser(db, bob, () => db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-evt"]));
      await db.query("reset role");
      const events = await db.query<{ event_type: string; actor_type: string }>(
        `select event_type, actor_type from public.transaction_events where order_id = $1 and event_type = 'payment.initiated'`,
        [order.order_id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].actor_type).toBe("buyer");
    });

    it("cannot initiate payment once the order has already been confirmed (paid)", async () => {
      const order = await makeOrder(alice, bob);
      await db.query(`update public.payments set status = 'paid' where order_id = $1`, [order.order_id]);
      await db.query(`update public.orders set status = 'confirmed' where id = $1`, [order.order_id]);
      await asUser(db, bob, async () => {
        await expect(
          db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-late"]),
        ).rejects.toThrow(/not payable|already been paid/i);
      });
    });

    it("a completed payment is never replaced by a new attempt — the provider_reference stays whatever PAID recorded", async () => {
      const order = await makeOrder(alice, bob);
      await asUser(db, bob, () => db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-first"]));
      await db.query(`update public.payments set status = 'paid' where order_id = $1`, [order.order_id]);
      await db.query(`update public.orders set status = 'confirmed' where id = $1`, [order.order_id]);
      await asUser(db, bob, async () => {
        await expect(
          db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-second"]),
        ).rejects.toThrow();
      });
      await db.query("reset role");
      const payment = await db.query<{ provider_reference: string }>(
        `select provider_reference from public.payments where order_id = $1`,
        [order.order_id],
      );
      expect(payment.rows[0].provider_reference).toBe("ref-first");
    });

    it("allows a fresh attempt (retry) after a previous payment failed", async () => {
      const order = await makeOrder(alice, bob);
      await asUser(db, bob, () => db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-fail-1"]));
      await db.query(`update public.payments set status = 'failed' where order_id = $1`, [order.order_id]);
      await asUser(db, bob, () => db.query(`select public.record_payment_attempt($1, $2)`, [order.order_id, "ref-retry"]));
      await db.query("reset role");
      const payment = await db.query<{ status: string; provider_reference: string }>(
        `select status, provider_reference from public.payments where order_id = $1`,
        [order.order_id],
      );
      expect(payment.rows[0].status).toBe("pending");
      expect(payment.rows[0].provider_reference).toBe("ref-retry");
    });
  });

  describe("record_payment_attempt() — access control on the function itself", () => {
    it("normal authenticated clients cannot mutate payment records directly (unchanged from Phase 4A — no UPDATE policy exists)", async () => {
      const order = await makeOrder(alice, bob);
      const r = await asUser(db, bob, () =>
        db.query(`update public.payments set provider_reference = 'forged' where order_id = $1`, [order.order_id]),
      );
      expect(r.affectedRows).toBe(0);
    });
  });

  describe("process_payfast_itn() — amount and existence verification", () => {
    it("4. rejects an event for an unknown order", async () => {
      await db.query("reset role");
      const r = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'ref', 'paid', 50000)`,
        ["00000000-0000-4000-8000-000000000000"],
      );
      expect(r.rows[0].outcome).toBe("rejected_not_found");
    });

    it("5. rejects an event whose amount doesn't match the authoritative order total", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      const r = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'ref', 'paid', 1)`,
        [order.order_id],
      );
      expect(r.rows[0].outcome).toBe("rejected_amount_mismatch");

      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [
        order.order_id,
      ]);
      expect(payment.rows[0].status).toBe("pending");
    });

    it("rejects an unrecognized status value rather than guessing", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      const r = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'ref', 'refunded', 50000)`,
        [order.order_id],
      );
      expect(r.rows[0].outcome).toBe("rejected_invalid_status");
    });
  });

  describe("process_payfast_itn() — success path", () => {
    it("6. a verified paid event moves payment to paid and order to confirmed", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      const r = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-1', 'paid', 50000)`,
        [order.order_id],
      );
      expect(r.rows[0].outcome).toBe("confirmed");

      const payment = await db.query<{ status: string; provider_reference: string }>(
        `select status, provider_reference from public.payments where order_id = $1`,
        [order.order_id],
      );
      expect(payment.rows[0].status).toBe("paid");
      expect(payment.rows[0].provider_reference).toBe("pf-ref-1");

      const orderRow = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [order.order_id]);
      expect(orderRow.rows[0].status).toBe("confirmed");
    });

    it("7. records exactly one payment.confirmed transaction event, actor payment_provider", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-2', 'paid', 50000)`, [order.order_id]);
      const events = await db.query<{ event_type: string; actor_type: string }>(
        `select event_type, actor_type from public.transaction_events where order_id = $1 and event_type = 'payment.confirmed'`,
        [order.order_id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].actor_type).toBe("payment_provider");
    });

    it("8. commission snapshot is unchanged by payment confirmation", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      const before = await db.query<{ rate_bps: number; commission_amount_cents: string }>(
        `select rate_bps, commission_amount_cents from public.commissions where order_id = $1`,
        [order.order_id],
      );
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-3', 'paid', 50000)`, [order.order_id]);
      const after = await db.query<{ rate_bps: number; commission_amount_cents: string }>(
        `select rate_bps, commission_amount_cents from public.commissions where order_id = $1`,
        [order.order_id],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it("does not create a payout", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-4', 'paid', 50000)`, [order.order_id]);
      const payouts = await db.query(`select 1 from public.payouts`);
      expect(payouts.rows).toHaveLength(0);
    });

    it("does not restore the listing to published", async () => {
      const product = await db.query<{ id: string }>(
        `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, status)
         values ('parent', $1, $2, 'Stays Sold Item', 'good', 50000, 'published') returning id`,
        [alice, categoryId],
      );
      const created = await asUser(db, bob, () =>
        db.query<{ order_id: string }>(`select * from public.create_order($1, 'collection')`, [product.rows[0].id]),
      );
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-5', 'paid', 50000)`, [
        created.rows[0].order_id,
      ]);
      const productRow = await db.query<{ status: string }>(`select status from public.products where id = $1`, [
        product.rows[0].id,
      ]);
      expect(productRow.rows[0].status).toBe("sold");
    });
  });

  describe("process_payfast_itn() — failure path", () => {
    it("9. a verified failed event moves payment to failed, order stays pending_payment", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      const r = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-6', 'failed', 50000)`,
        [order.order_id],
      );
      expect(r.rows[0].outcome).toBe("failed_recorded");

      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [
        order.order_id,
      ]);
      expect(payment.rows[0].status).toBe("failed");

      const orderRow = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [order.order_id]);
      expect(orderRow.rows[0].status).toBe("pending_payment");
    });

    it("10. a failed payment does not create a payment.confirmed event", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-7', 'failed', 50000)`, [order.order_id]);
      const confirmedEvents = await db.query(
        `select 1 from public.transaction_events where order_id = $1 and event_type = 'payment.confirmed'`,
        [order.order_id],
      );
      expect(confirmedEvents.rows).toHaveLength(0);
    });
  });

  describe("process_payfast_itn() — idempotency (duplicate ITN)", () => {
    it("11. duplicate COMPLETE (paid) events are safe — no duplicate transaction event, no error", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      const first = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-8', 'paid', 50000)`,
        [order.order_id],
      );
      const second = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-8', 'paid', 50000)`,
        [order.order_id],
      );
      expect(first.rows[0].outcome).toBe("confirmed");
      expect(second.rows[0].outcome).toBe("duplicate_ignored");

      const events = await db.query(
        `select 1 from public.transaction_events where order_id = $1 and event_type = 'payment.confirmed'`,
        [order.order_id],
      );
      expect(events.rows).toHaveLength(1);
    });

    it("12. duplicate CANCELLED (failed) events for the same reference are safe — no duplicate event", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-9', 'failed', 50000)`, [order.order_id]);
      const second = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-9', 'failed', 50000)`,
        [order.order_id],
      );
      expect(second.rows[0].outcome).toBe("duplicate_ignored");

      const events = await db.query(
        `select 1 from public.transaction_events where order_id = $1 and event_type = 'payment.failed'`,
        [order.order_id],
      );
      expect(events.rows).toHaveLength(1);
    });
  });

  describe("process_payfast_itn() — state machine protection", () => {
    it("13. PAID cannot be downgraded to PENDING by a delayed/out-of-order event", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-10', 'paid', 50000)`, [order.order_id]);

      // Simulate a delayed webhook arriving after confirmation.
      const outcome = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-10-late', 'failed', 50000)`,
        [order.order_id],
      );
      expect(outcome.rows[0].outcome).toBe("duplicate_ignored");

      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [
        order.order_id,
      ]);
      expect(payment.rows[0].status).toBe("paid");
    });

    it("14. PAID cannot be downgraded to FAILED by a delayed/out-of-order event", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-11', 'paid', 50000)`, [order.order_id]);
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-11-dup', 'failed', 50000)`, [
        order.order_id,
      ]);
      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [
        order.order_id,
      ]);
      expect(payment.rows[0].status).toBe("paid");
      const orderRow = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [order.order_id]);
      expect(orderRow.rows[0].status).toBe("confirmed");
    });

    it("a genuine retry-after-failure succeeding (FAILED -> PAID) is an explicit, deliberate design decision — not blocked", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("reset role");
      await db.query(`select outcome from public.process_payfast_itn($1, 'pf-ref-12-fail', 'failed', 50000)`, [
        order.order_id,
      ]);
      const retry = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-12-retry', 'paid', 50000)`,
        [order.order_id],
      );
      expect(retry.rows[0].outcome).toBe("confirmed");
      const payment = await db.query<{ status: string }>(`select status from public.payments where order_id = $1`, [
        order.order_id,
      ]);
      expect(payment.rows[0].status).toBe("paid");
    });
  });

  describe("process_payfast_itn() — access control on the function itself", () => {
    it("15. a normal authenticated client cannot call process_payfast_itn to fake a payment confirmation", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await asUser(db, bob, async () => {
        await expect(
          db.query(`select public.process_payfast_itn($1, 'forged', 'paid', 50000)`, [order.order_id]),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("anon cannot call process_payfast_itn either", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await asAnon(db, async () => {
        await expect(
          db.query(`select public.process_payfast_itn($1, 'forged', 'paid', 50000)`, [order.order_id]),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("service_role can call it (the only legitimate caller — the webhook route)", async () => {
      const order = await makeOrder(alice, bob, 50000);
      await db.query("set role service_role");
      const r = await db.query<{ outcome: string }>(
        `select outcome from public.process_payfast_itn($1, 'pf-ref-svc', 'paid', 50000)`,
        [order.order_id],
      );
      await db.query("reset role");
      expect(r.rows[0].outcome).toBe("confirmed");
    });
  });

  describe("function security posture", () => {
    it("record_payment_attempt() is SECURITY DEFINER, pinned search_path, EXECUTE restricted to authenticated only", async () => {
      await db.query("reset role");
      const r = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where proname = 'record_payment_attempt'`,
      );
      expect(r.rows[0].prosecdef).toBe(true);
      expect(r.rows[0].proconfig).toContain("search_path=public");

      const grants = await db.query<{ grantee: string }>(`
        select grantee from information_schema.routine_privileges
        where routine_name = 'record_payment_attempt' and privilege_type = 'EXECUTE'
      `);
      const grantees = grants.rows.map((row) => row.grantee).sort();
      expect(grantees).not.toContain("PUBLIC");
      expect(grantees).not.toContain("anon");
      expect(grantees).toEqual(expect.arrayContaining(["authenticated"]));
    });

    it("process_payfast_itn() is NOT SECURITY DEFINER (its only caller already bypasses RLS via service_role) and EXECUTE is restricted to service_role only", async () => {
      await db.query("reset role");
      const r = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where proname = 'process_payfast_itn'`,
      );
      expect(r.rows[0].prosecdef).toBe(false);
      expect(r.rows[0].proconfig).toContain("search_path=public");

      const grants = await db.query<{ grantee: string }>(`
        select grantee from information_schema.routine_privileges
        where routine_name = 'process_payfast_itn' and privilege_type = 'EXECUTE'
      `);
      const grantees = grants.rows.map((row) => row.grantee).sort();
      // `postgres` (the function owner) always implicitly has execute
      // rights, shown explicitly here — that's expected, not a gap.
      // PUBLIC/anon/authenticated must never appear.
      expect(grantees).not.toContain("PUBLIC");
      expect(grantees).not.toContain("anon");
      expect(grantees).not.toContain("authenticated");
      expect(grantees).toContain("service_role");
    });
  });

  describe("payments.provider_reference uniqueness", () => {
    it("a partial unique index exists (NULLs excluded) on payments.provider_reference", async () => {
      await db.query("reset role");
      const r = await db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'payments'`);
      expect(r.rows.map((row) => row.indexname)).toContain("payments_provider_reference_idx");
    });

    it("two different orders cannot end up with the same provider_reference", async () => {
      const orderA = await makeOrder(alice, bob, 10000);
      const orderB = await makeOrder(alice, carol, 10000);
      await db.query("reset role");
      await db.query(`update public.payments set provider_reference = 'shared-ref' where order_id = $1`, [orderA.order_id]);
      await expect(
        db.query(`update public.payments set provider_reference = 'shared-ref' where order_id = $1`, [orderB.order_id]),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});
