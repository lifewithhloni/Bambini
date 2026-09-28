import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const stripped = (...parts: string[]) =>
  readFileSync(join(root, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const serverFiles = ["actions.ts", "getNotifications.ts", "getUnreadCount.ts"].map((f) => [f, stripped("src", "server", "notifications", f)] as const);
const componentFiles = readdirSync(join(root, "src", "components", "notifications"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, stripped("src", "components", "notifications", f)] as const);
const page = stripped("src", "app", "account", "notifications", "page.tsx");
const header = stripped("src", "components", "SiteHeader.tsx");
const actions = stripped("src", "server", "notifications", "actions.ts");
const migration = readFileSync(join(root, "supabase", "migrations", "20261013090000_in_app_notifications.sql"), "utf8");

describe("notification app code never creates notifications (E)", () => {
  it("nothing in the app inserts, deletes or upserts a notification — creation belongs to database triggers", () => {
    for (const [name, src] of [...serverFiles, ...componentFiles]) {
      expect(src, name).not.toMatch(/\.insert\(|\.upsert\(|\.delete\(|push_notification|\.rpc\(/);
    }
  });

  it("the only write is marking read, and it never sends anything but read_at", () => {
    const updates = [...actions.matchAll(/\.update\(\{([^}]*)\}\)/g)].map((m) => m[1].trim());
    expect(updates).toHaveLength(2);
    for (const body of updates) expect(body).toMatch(/^read_at: new Date\(\)\.toISOString\(\)$/);
  });

  it("no service-role client is used for notifications", () => {
    for (const [name, src] of [...serverFiles, ...componentFiles]) expect(src, name).not.toMatch(/createAdminClient|service_role/);
  });
});

describe("read state and counts are server truth (H)", () => {
  it("nothing keeps notification or unread state in the browser", () => {
    for (const [name, src] of componentFiles) {
      expect(src, name).not.toMatch(/localStorage|sessionStorage|useState<.*[Nn]otification|setUnread/);
    }
  });

  it("the header bell renders only a count read from the database, and only for a signed-in user", () => {
    const bell = componentFiles.find(([n]) => n === "NotificationBell.tsx")![1];
    expect(bell).toMatch(/getUnreadNotificationCount\(userId\)/);
    expect(header).toMatch(/<NotificationBell userId=\{user\.id\}/);
    const signedOutBranch = header.slice(header.indexOf(") : ("));
    expect(signedOutBranch).not.toMatch(/NotificationBell/);
  });
});

describe("notification links never carry authorization — the destination route always re-derives it (14C hardening)", () => {
  // notificationHref() can only ever build one of these fixed route
  // templates from an opaque reference id. This test asserts each
  // destination independently re-checks that the id belongs to the
  // viewer before rendering anything, so a notification whose data
  // referenced an unrelated id — a future producer bug, since none of
  // today's producers can write one — can at worst land on that route's
  // own not-found, never on another user's data.
  const routes: [string, string[]][] = [
    ["src/app/account/orders/[id]/page.tsx", ["order.buyer_id !== user.id", "notFound()"]],
    ["src/app/sell/orders/[id]/page.tsx", ["viewerIsOrderSeller(order", "notFound()"]],
    ["src/app/account/business/[id]/orders/[orderId]/page.tsx", ["requireBusinessAccess(id", "getBusinessOrderDetail(id, orderId)", "notFound()"]],
    ["src/app/account/messages/[threadId]/page.tsx", ["getThread(threadId, user.id", "notFound()"]],
    ["src/app/account/business/[id]/messages/[threadId]/page.tsx", ["requireBusinessAccess(id", "getThread(threadId, userId", "notFound()"]],
    ["src/app/account/business/[id]/payouts/page.tsx", ["requireBusinessAccess(id"]],
    ["src/app/sell/payouts/page.tsx", ["requireUser(\"/sell/payouts\")"]],
  ];

  for (const [path, mustContain] of routes) {
    it(`${path} still re-authorizes independently`, () => {
      const src = stripped(...path.split("/"));
      for (const needle of mustContain) expect(src, `${path} missing "${needle}"`).toContain(needle);
    });
  }
});

describe("no realtime, email, SMS or push (scope)", () => {
  it("none of it appears in the notification code", () => {
    for (const [name, src] of [...serverFiles, ...componentFiles, ["page.tsx", page] as const]) {
      expect(src, name).not.toMatch(/\.channel\(|\.subscribe\(|postgres_changes|setInterval|EventSource|WebSocket|pushManager|serviceWorker|sendEmail|resend|twilio/i);
    }
  });
});

describe("the migration keeps producers internal and content safe", () => {
  it("revokes execute on every producer from client roles", () => {
    const producers = [...migration.matchAll(/^create function public\.(\w+)/gm)].map((m) => m[1]);
    expect(producers.length).toBeGreaterThanOrEqual(10);
    for (const fn of producers) {
      expect(migration, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(`));
    }
  });

  it("every producer swallows its own failure so it can never abort the underlying event", () => {
    const eventProducers = ["notify_on_transaction_event", "notify_on_dispute_resolved", "notify_on_message", "notify_on_identity_verification_decision", "notify_on_business_verification_decision", "notify_on_payout_outcome"];
    for (const fn of eventProducers) {
      const start = migration.indexOf(`create function public.${fn}(`);
      const body = migration.slice(start, migration.indexOf("$$;", migration.indexOf("as $$", start) + 5));
      expect(body, fn).toMatch(/exception when others then\s+raise warning/);
    }
  });

  it("notification text never reads message bodies, reasons, notes or amounts", () => {
    const producerSql = migration.slice(migration.indexOf("-- Event source 1"));
    expect(producerSql).not.toMatch(/new\.body|new\.notes|new\.reason|new\.description|resolution_notes|amount_cents|payload/i);
  });
});
