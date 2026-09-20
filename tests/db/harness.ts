import { PGlite, type Results } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
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
  const db = new PGlite({ extensions: { postgis, pgcrypto } });

  await db.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
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

export async function makeUser(db: PGlite, fullName: string): Promise<string> {
  const r: Results<{ id: string }> = await db.query(
    `insert into auth.users (raw_user_meta_data) values (jsonb_build_object('full_name', $1::text)) returning id`,
    [fullName],
  );
  return r.rows[0].id; // handle_new_user() trigger creates the matching profiles row
}
