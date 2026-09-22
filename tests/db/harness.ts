import { PGlite, type Results } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "../../supabase/migrations");
const SEED_FILE = path.resolve(here, "../../supabase/seed.sql");

/**
 * Boots a real Postgres engine (PGlite — Postgres compiled to WASM, not a
 * mock) with PostGIS, and lays down a minimal stand-in for what the
 * Supabase platform provisions before any project migration runs:
 * auth.users (with the raw_user_meta_data column handle_new_user() reads),
 * auth.uid() (reading the same request.jwt.claim.sub GUC PostgREST sets
 * per request), storage.objects (the table Supabase Storage's own RLS
 * policies target — see the Phase 2A product-images storage migration),
 * and the anon/authenticated/service_role roles with the default table
 * privileges Supabase grants on every new public/storage table.
 *
 * This is not a substitute for testing against the real Supabase CLI +
 * Docker stack (no real GoTrue/PostgREST/Storage service here — the
 * storage.objects stub only has the columns our own policies reference,
 * not Storage's full real schema) — see DATABASE.md — but it runs our
 * actual migration SQL and actual RLS policies against a real Postgres,
 * not a description of them.
 */
export async function bootDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { postgis, pgcrypto, pg_trgm } });

  await db.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      -- Phase 5: the columns is_profile_fully_verified()/can_transact()
      -- actually read. Real Supabase's auth.users has both; this stub
      -- mirrors just the two columns any migration function touches, the
      -- same "minimal stand-in for what Supabase provisions" scope this
      -- file's own header comment already describes for the rest of the
      -- table. Neither is granted to anon/authenticated below (matching
      -- real Supabase — the auth schema is never directly queryable by
      -- client roles), so the only way anything in tests ever reads them
      -- is through the SECURITY DEFINER functions that are the actual
      -- thing under test.
      phone text,
      email_confirmed_at timestamptz,
      phone_confirmed_at timestamptz,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create schema storage;
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null,
      name text not null,
      owner_id text,
      created_at timestamptz not null default now()
    );
    -- Simplified vs. the real storage.foldername(), which drops the
    -- trailing filename segment — every policy here only ever reads
    -- index [1] (the leading "<product_id>/" segment), where the two
    -- implementations agree.
    create function storage.foldername(name text) returns text[]
    language sql immutable as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;

    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;

    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public
      grant select, insert, update, delete on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public
      grant usage, select on sequences to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public
      grant execute on functions to anon, authenticated, service_role;

    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  `);

  return db;
}

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

export type MigrationResult = { file: string; ok: boolean; error?: string };

/** Applies every migration file in order, then seed.sql. Stops at the first failure by default. */
export async function applyAll(db: PGlite, { stopOnError = true } = {}): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(file, "utf8");
    const name = path.basename(file);
    try {
      await db.exec(sql);
      results.push({ file: name, ok: true });
    } catch (e) {
      results.push({ file: name, ok: false, error: (e as Error).message });
      if (stopOnError) return results;
    }
  }

  const seedName = path.basename(SEED_FILE);
  try {
    await db.exec(fs.readFileSync(SEED_FILE, "utf8"));
    results.push({ file: seedName, ok: true });
  } catch (e) {
    results.push({ file: seedName, ok: false, error: (e as Error).message });
  }

  return results;
}

/** Boots a DB and applies every migration + seed, throwing with the exact failure if anything doesn't apply. */
export async function bootAndMigrate(): Promise<PGlite> {
  const db = await bootDb();
  const results = await applyAll(db, { stopOnError: true });
  const failed = results.find((r) => !r.ok);
  if (failed) {
    throw new Error(`Migration ${failed.file} failed: ${failed.error}`);
  }
  return db;
}

/** Runs `fn` as a signed-in `authenticated` user (auth.uid() = userId), then restores role/session state. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("reset role");
  await db.query(`set request.jwt.claim.sub = '${userId}'`);
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("reset request.jwt.claim.sub");
  }
}

/** Runs `fn` as the `anon` role (no signed-in user). */
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.query("reset role");
  await db.query("reset request.jwt.claim.sub");
  await db.query("set role anon");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

/** Runs `fn` as `service_role` (bypasses RLS — mirrors src/lib/supabase/admin.ts). */
export async function asServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.query("reset role");
  await db.query("set role service_role");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

// Unique-per-process, not per-db — fine, since PGlite instances in this
// suite are never shared across test files and each test file's users
// only need to be unique within its own single in-memory database.
let fixtureIdNumberCounter = 0;

/**
 * Phase 5: fully verified (confirmed email, confirmed phone, an approved
 * identity_verifications row) by default — most tests are not *about*
 * verification, and a real, eligible user is the more useful default
 * fixture, the same reasoning Phase 4C's makeEligibleSeller() already
 * used for cash eligibility specifically. Pass `{ verified: false }` for
 * a test that genuinely needs an unverified user (this file's own
 * verification.test.ts, and a handful of targeted cash-eligibility
 * tests) — nothing else needs to change at existing call sites.
 */
export async function makeUser(db: PGlite, fullName: string, opts: { verified?: boolean } = {}): Promise<string> {
  const verified = opts.verified ?? true;

  const r: Results<{ id: string }> = await db.query(
    `insert into auth.users (raw_user_meta_data, email_confirmed_at, phone_confirmed_at)
     values (jsonb_build_object('full_name', $1::text), $2, $2)
     returning id`,
    [fullName, verified ? new Date().toISOString() : null],
  );
  const id = r.rows[0].id; // handle_new_user() trigger creates the matching profiles row

  if (verified) {
    fixtureIdNumberCounter += 1;
    const idNumber = `8001015${String(fixtureIdNumberCounter).padStart(6, "0")}`; // 13 digits, unique per fixture
    await db.query(
      `insert into public.identity_verifications (profile_id, provider, document_type, document_storage_path, id_number, status, reviewed_at)
       values ($1, 'manual', 'sa_id', 'test-fixtures/id.jpg', $2, 'verified', now())`,
      [id, idNumber],
    );
  }

  return id;
}

let deliveryQuoteRefCounter = 0;

/**
 * Phase 7A: a fixture row in delivery_quotes, inserted directly (as the
 * PGlite bootstrap role, outside RLS — the same "raw fixture insert"
 * pattern tests/db/rls.test.ts already uses for orders/payments, since
 * delivery_quotes has no authenticated INSERT policy at all by design —
 * see 20260930090000_delivery_quoting_booking.sql). Mirrors exactly what
 * the real quote service (src/server/delivery/quoteService.ts) would
 * have persisted: requested_by/product_id set (Phase 7A's ownership +
 * replay-prevention columns), a real provider_id resolved from the
 * seeded 'mock' delivery_providers row (see supabase/seed.sql), and a
 * future expires_at unless the caller deliberately wants an expired one.
 */
export async function makeDeliveryQuote(
  db: PGlite,
  opts: {
    buyerId: string;
    productId: string;
    pickupLocationId: string;
    dropoffLocationId: string;
    /** Shorthand for providerCostCents when no markup is being tested — kept for every pre-Phase-7C call site, which all implicitly mean "provider cost, 0% markup". */
    priceCents?: number;
    /** Phase 7C: the provider's own raw cost. Defaults to priceCents (or 5000) — i.e. 0% markup — unless markupPercentageBps is also given. */
    providerCostCents?: number;
    /** Phase 7C: the rate to snapshot onto this quote, mirroring exactly what quoteService.ts would have read from delivery_markup_settings at fetch time. price_cents (the buyer-facing fee) is always derived from providerCostCents + this, never passed separately. */
    markupPercentageBps?: number;
    serviceLevel?: "cheapest" | "standard" | "express";
    expiresInMinutes?: number;
    providerSlug?: string;
  },
): Promise<string> {
  const provider = await db.query<{ id: string }>(
    `select id from public.delivery_providers where slug = $1 limit 1`,
    [opts.providerSlug ?? "mock"],
  );
  if (provider.rows.length === 0) {
    throw new Error(`No delivery_providers row for slug "${opts.providerSlug ?? "mock"}" — check supabase/seed.sql`);
  }

  const providerCostCents = opts.providerCostCents ?? opts.priceCents ?? 5000;
  const markupPercentageBps = opts.markupPercentageBps ?? 0;
  // Same round-half-up-in-integer-cents formula as
  // calculateDeliveryMarkup()/create_order()'s own commission rounding —
  // a fixture computing this any other way could silently drift from
  // what the real code under test actually produces.
  const markupAmountCents = Math.round((providerCostCents * markupPercentageBps) / 10000);
  const priceCents = providerCostCents + markupAmountCents;

  deliveryQuoteRefCounter += 1;
  const r = await db.query<{ id: string }>(
    `insert into public.delivery_quotes (
       requested_by, product_id, pickup_location_id, dropoff_location_id, provider_id,
       service_level, price_cents, provider_cost_cents, markup_percentage_bps, markup_amount_cents,
       currency, eta_min_minutes, eta_max_minutes,
       provider_quote_ref, expires_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ZAR', 60, 120, $11, now() + ($12 || ' minutes')::interval)
     returning id`,
    [
      opts.buyerId,
      opts.productId,
      opts.pickupLocationId,
      opts.dropoffLocationId,
      provider.rows[0].id,
      opts.serviceLevel ?? "standard",
      priceCents,
      providerCostCents,
      markupPercentageBps,
      markupAmountCents,
      `test-quote-ref-${deliveryQuoteRefCounter}`,
      String(opts.expiresInMinutes ?? 15),
    ],
  );
  return r.rows[0].id;
}
