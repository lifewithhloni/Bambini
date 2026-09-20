import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

const eqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { updateProfile } = await import("./actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  requireUserMock.mockReset();
  fromMock.mockClear();
  updateMock.mockClear();
  eqMock.mockReset();
  revalidatePathMock.mockClear();
});

describe("updateProfile action", () => {
  it("scopes the update to the session user's own id, never a client-supplied one", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    eqMock.mockResolvedValue({ error: null });

    // Even if a malicious caller stuffed an "id" field into the form,
    // the action never reads it — only requireUser()'s verified id is used.
    const result = await updateProfile(null, formData({ fullName: "Alice B", phone: "", id: "someone-elses-id" }));

    expect(result).toEqual({ success: true });
    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(updateMock).toHaveBeenCalledWith({ full_name: "Alice B", phone: null });
    expect(eqMock).toHaveBeenCalledWith("id", "user-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
  });

  it("rejects invalid input before touching the database", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });

    const result = await updateProfile(null, formData({ fullName: "", phone: "" }));

    expect(result).toEqual({ error: expect.any(String) });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("surfaces a generic error if the update fails", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    eqMock.mockResolvedValue({ error: { message: "row-level security violation" } });

    const result = await updateProfile(null, formData({ fullName: "Alice B", phone: "" }));

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("requires an authenticated session before doing anything else", async () => {
    requireUserMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(updateProfile(null, formData({ fullName: "Alice B", phone: "" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(fromMock).not.toHaveBeenCalled();
  });
});
