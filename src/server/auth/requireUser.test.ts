import { describe, expect, it, vi, beforeEach } from "vitest";

// The real `server-only` package throws when imported outside Next's
// bundler (which normally strips it to a no-op); stub it so this file
// is importable under plain Vitest/Node.
vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getUser } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

class RedirectSignal extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}
const redirect = vi.fn((target: string) => {
  // Mirrors Next.js's real behavior: redirect() throws to interrupt
  // rendering, so requireUser() never returns past it.
  throw new RedirectSignal(target);
});
vi.mock("next/navigation", () => ({ redirect }));

const { requireUser, getOptionalUser } = await import("./requireUser");

beforeEach(() => {
  getUser.mockReset();
  redirect.mockClear();
  createClient.mockReset();
  createClient.mockImplementation(async () => ({ auth: { getUser } }));
});

describe("requireUser", () => {
  it("returns the user when a session exists", async () => {
    const user = { id: "user-1", email: "alice@example.com" };
    getUser.mockResolvedValue({ data: { user }, error: null });

    const result = await requireUser();

    expect(result).toBe(user);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireUser()).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when getUser() errors", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid token") });

    await expect(requireUser()).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("carries the current path through as a ?next= redirect target", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireUser("/account/orders")).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/login?next=%2Faccount%2Forders");
  });

  it("never trusts a client-supplied id — it only ever reads the verified session user", async () => {
    // requireUser() takes no user-id parameter at all; this test exists
    // to document and pin that contract so a future change can't
    // accidentally add a way to pass one in.
    expect(requireUser.length).toBe(1); // only the (optional) currentPath param
  });
});

describe("getOptionalUser", () => {
  it("returns the user when a session exists", async () => {
    const user = { id: "user-1", email: "alice@example.com" };
    getUser.mockResolvedValue({ data: { user }, error: null });

    expect(await getOptionalUser()).toBe(user);
  });

  it("returns null (not throw) when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await getOptionalUser()).toBeNull();
  });

  it("returns null (never crashes the page) if Supabase isn't configured — e.g. missing env vars", async () => {
    createClient.mockImplementation(async () => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    });

    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("never redirects — it's for UI that must degrade gracefully, not gate access", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await getOptionalUser();

    expect(redirect).not.toHaveBeenCalled();
  });
});
