import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Result = { data?: unknown; error?: unknown; count?: number | null };

const calls: { method: string; args: unknown[] }[] = [];
let nextResult: Result = { data: [], error: null };
let signedInUser: { id: string } | null = { id: "user-1" };

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "or", "update"]) {
    c[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return c;
    });
  }
  c.then = (resolve: (v: Result) => unknown) => Promise.resolve(nextResult).then(resolve);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: vi.fn(() => chain()) })) }));
vi.mock("@/server/auth/requireUser", () => ({ getOptionalUser: vi.fn(async () => signedInUser) }));

const { getNotifications } = await import("./getNotifications");
const { getUnreadNotificationCount } = await import("./getUnreadCount");
const { markNotificationRead, markAllNotificationsRead } = await import("./actions");

const ORDER = "11111111-1111-4111-8111-111111111111";

function row(i: number, overrides: Record<string, unknown> = {}) {
  const n = String(i).padStart(12, "0");
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${n}`,
    type: "payment_updated",
    title: `Note ${i}`,
    body: "Body",
    data: { order_id: ORDER, audience: "buyer" },
    read_at: null,
    created_at: `2026-09-28T12:00:${String(59 - (i % 59)).padStart(2, "0")}.000000+00:00`,
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: [], error: null };
  signedInUser = { id: "user-1" };
});

const called = (method: string) => calls.filter((c) => c.method === method);

describe("getNotifications", () => {
  it("scopes the read to the viewer, newest first, and asks for one extra row to know whether more exist", async () => {
    await getNotifications("user-1");
    expect(called("eq")[0].args).toEqual(["profile_id", "user-1"]);
    expect(called("order").map((c) => c.args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(called("limit")[0].args).toEqual([51]);
    expect(called("or")).toHaveLength(0);
  });

  it("J. returns at most 50 items and a cursor only when there is a further page", async () => {
    nextResult = { data: Array.from({ length: 51 }, (_, i) => row(i)), error: null };
    const page = await getNotifications("user-1");
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe(`${row(49).created_at}|${row(49).id}`);

    nextResult = { data: Array.from({ length: 50 }, (_, i) => row(i)), error: null };
    expect((await getNotifications("user-1")).nextCursor).toBeNull();
  });

  it("applies a keyset filter for a valid cursor and ignores an invalid one", async () => {
    const r = row(3);
    await getNotifications("user-1", `${r.created_at}|${r.id}`);
    expect(called("or")).toHaveLength(1);
    expect(String(called("or")[0].args[0])).toContain(r.id);

    calls.length = 0;
    await getNotifications("user-1", `2026-01-01",id.eq.x|${r.id}`);
    expect(called("or")).toHaveLength(0);
  });

  it("H. unread comes from the database's read_at, and the link is derived, never stored", async () => {
    nextResult = { data: [row(1), row(2, { read_at: "2026-09-28T12:30:00Z" }), row(3, { data: {} })], error: null };
    const { items } = await getNotifications("user-1");
    expect(items.map((n) => n.unread)).toEqual([true, false, true]);
    expect(items[0].href).toBe(`/account/orders/${ORDER}`);
    expect(items[2].href).toBeNull();
  });

  it("a failed read throws — it is never returned as an empty list", async () => {
    nextResult = { data: null, error: { message: "boom" } };
    await expect(getNotifications("user-1")).rejects.toThrow(/Failed to load notifications/);
  });

  it("a genuinely empty result is an empty page", async () => {
    nextResult = { data: [], error: null };
    expect(await getNotifications("user-1")).toEqual({ items: [], nextCursor: null });
  });
});

describe("getUnreadNotificationCount", () => {
  it("returns null for a signed-out visitor without querying", async () => {
    expect(await getUnreadNotificationCount(null)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns the database count, scoped to the user's unread rows", async () => {
    nextResult = { count: 7, error: null };
    expect(await getUnreadNotificationCount("user-1")).toBe(7);
    expect(called("eq")[0].args).toEqual(["profile_id", "user-1"]);
    expect(called("is")[0].args).toEqual(["read_at", null]);
  });

  it("returns null — no badge, no invented number — when the count can't be read", async () => {
    nextResult = { count: null, error: { message: "boom" } };
    expect(await getUnreadNotificationCount("user-1")).toBeNull();
  });
});

describe("mark-read actions", () => {
  it("R. refuse anonymous callers before touching the database", async () => {
    signedInUser = null;
    expect(await markNotificationRead(ORDER)).toEqual({ error: expect.any(String) });
    expect(await markAllNotificationsRead()).toEqual({ error: expect.any(String) });
    expect(calls).toHaveLength(0);
  });

  it("reject a malformed id without querying", async () => {
    expect(await markNotificationRead("not-a-uuid")).toEqual({ error: expect.any(String) });
    expect(calls).toHaveLength(0);
  });

  it("C. mark one read for the signed-in user only, and only if still unread — never trusting a recipient from the client", async () => {
    expect(await markNotificationRead(ORDER)).toEqual({ ok: true });
    expect(called("eq").map((c) => c.args)).toEqual([
      ["id", ORDER],
      ["profile_id", "user-1"],
    ]);
    expect(called("is")[0].args).toEqual(["read_at", null]);
  });

  it("mark all read is scoped to the signed-in user's own unread rows", async () => {
    expect(await markAllNotificationsRead()).toEqual({ ok: true });
    expect(called("eq").map((c) => c.args)).toEqual([["profile_id", "user-1"]]);
    expect(called("is")[0].args).toEqual(["read_at", null]);
  });

  it("report a database failure as an error, not success", async () => {
    nextResult = { error: { message: "boom" } };
    expect(await markNotificationRead(ORDER)).toEqual({ error: expect.any(String) });
    expect(await markAllNotificationsRead()).toEqual({ error: expect.any(String) });
  });
});
