import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAndMigrate, makeUser } from "./harness";

describe("database schema", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bootAndMigrate();
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies every migration and seed.sql cleanly", () => {
    // If beforeAll got here without throwing, every migration in
    // supabase/migrations/ (in filename order) plus seed.sql applied
    // without error against a real Postgres + PostGIS engine.
    expect(db).toBeDefined();
  });

  it("creates every expected table (36 Bambini tables + PostGIS's own spatial_ref_sys)", async () => {
    const r = await db.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);
    const names = r.rows.map((row) => row.table_name);
    expect(names).toContain("profiles");
    expect(names).toContain("orders");
    expect(names).toContain("transaction_events");
    expect(names).toContain("seller_cash_status");
    // 36 authored tables + PostGIS's spatial_ref_sys reference table.
    expect(names.length).toBe(37);
  });

  it("creates the public-safe views", async () => {
    const r = await db.query<{ table_name: string }>(
      `select table_name from information_schema.views where table_schema = 'public'`,
    );
    const names = r.rows.map((row) => row.table_name);
    expect(names).toContain("profiles_public");
    expect(names).toContain("businesses_public");
    expect(names).toContain("product_locations_public");
  });

  it("resolves every foreign key with no dangling references", async () => {
    const r = await db.query<{ table_name: string; column_name: string; foreign_table: string; foreign_column: string }>(`
      select tc.table_name, kcu.column_name, ccu.table_name as foreign_table, ccu.column_name as foreign_column
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    `);
    expect(r.rows.length).toBeGreaterThan(60);
    // Every referenced (foreign_table, foreign_column) pair must actually
    // exist as a real column — proves the FKs point at real targets, not
    // just that CREATE TABLE happened to succeed.
    for (const fk of r.rows) {
      const target = await db.query(
        `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
        [fk.foreign_table, fk.foreign_column],
      );
      expect(target.rows.length, `${fk.table_name}.${fk.column_name} -> ${fk.foreign_table}.${fk.foreign_column}`).toBe(1);
    }
  });

  it("has an index backing every foreign key used in RLS policy joins", async () => {
    // Spot-check the FKs that RLS policies join through most often —
    // missing an index here would make every policy check a seq scan.
    const idx = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname='public'`,
    );
    const names = idx.rows.map((r) => r.indexname);
    for (const expected of [
      "orders_buyer_id_idx",
      "orders_seller_profile_id_idx",
      "orders_business_id_idx",
      "products_seller_profile_id_idx",
      "products_business_id_idx",
      "payments_order_id_idx",
      "transaction_events_order_id_idx",
      "locations_geo_idx",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("uses bigint for every *_cents money column", async () => {
    const r = await db.query<{ table_name: string; column_name: string; data_type: string }>(`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and column_name like '%_cents'
    `);
    expect(r.rows.length).toBeGreaterThan(10);
    for (const row of r.rows) {
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe("bigint");
    }
  });

  it("snapshots commission rate + amount onto both orders and commissions", async () => {
    const r = await db.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.columns
      where table_schema='public' and table_name in ('orders','commissions')
        and column_name in ('commission_rate_bps','rate_bps','commission_amount_cents')
    `);
    const cols = r.rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(cols).toContain("orders.commission_rate_bps");
    expect(cols).toContain("orders.commission_amount_cents");
    expect(cols).toContain("commissions.rate_bps");
    expect(cols).toContain("commissions.commission_amount_cents");
  });

  it("enforces the seller_type/recipient_type XOR pattern on every polymorphic table", async () => {
    const r = await db.query<{ table_name: string }>(`
      select conrelid::regclass::text as table_name from pg_constraint
      where contype = 'c' and conname like '%matches_type%'
    `);
    const tables = r.rows.map((row) => row.table_name).sort();
    expect(tables).toEqual(
      ["message_threads", "orders", "payouts", "products", "reviews", "seller_cash_status"].sort(),
    );
  });

  it("enables RLS on every Bambini table (not PostGIS's own spatial_ref_sys)", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    const withoutRls = r.rows.filter((row) => !row.relrowsecurity).map((row) => row.relname);
    expect(withoutRls).toEqual(["spatial_ref_sys"]);
    expect(r.rows.filter((row) => row.relrowsecurity).length).toBe(36);
  });

  it("computes real PostGIS distances and only returns nearby active products", async () => {
    await db.query("reset role");
    const cat = await db.query<{ id: string }>(`select id from public.categories where slug = 'toys-baby' limit 1`);
    const seller = await makeUser(db, "Schema Test Seller");
    const near = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude) values ($1, -33.9249, 18.4241) returning id`,
      [seller],
    );
    const far = await db.query<{ id: string }>(
      `insert into public.locations (created_by, latitude, longitude) values ($1, -26.2041, 28.0473) returning id`,
      [seller],
    );
    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
       values ('parent', $1, $2, 'Near', 'good', 5000, $3, 'active')`,
      [seller, cat.rows[0].id, near.rows[0].id],
    );
    await db.query(
      `insert into public.products (seller_type, seller_profile_id, category_id, title, condition, price_cents, pickup_location_id, status)
       values ('parent', $1, $2, 'Far', 'good', 5000, $3, 'active')`,
      [seller, cat.rows[0].id, far.rows[0].id],
    );

    const nearby = await db.query<{ title: string; distance_km: string }>(
      `select title, distance_km from public.search_nearby_products($1, $2, $3, null)`,
      [-33.9249, 18.4241, 10],
    );
    expect(nearby.rows).toHaveLength(1);
    expect(nearby.rows[0].title).toBe("Near");
    expect(Number(nearby.rows[0].distance_km)).toBeCloseTo(0, 1);

    const wide = await db.query(`select 1 from public.search_nearby_products($1, $2, $3, null)`, [
      -33.9249, 18.4241, 2000,
    ]);
    expect(wide.rows).toHaveLength(2);
  });

  it("blocks UPDATE and DELETE on transaction_events even for the table owner", async () => {
    await db.query("reset role");
    const te = await db.query<{ id: string }>(
      `insert into public.transaction_events (entity_type, entity_id, event_type, actor_type) values ('order', gen_random_uuid(), 'order.created', 'system') returning id`,
    );
    await expect(
      db.query(`update public.transaction_events set event_type = 'hacked' where id = $1`, [te.rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.transaction_events where id = $1`, [te.rows[0].id])).rejects.toThrow(
      /append-only/,
    );
  });
});
