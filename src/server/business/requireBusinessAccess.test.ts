import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

class NotFoundSignal extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

const getBusinessForManageMock = vi.fn();
vi.mock("./getBusinessForManage", () => ({ getBusinessForManage: getBusinessForManageMock }));

const { requireBusinessAccess } = await import("./requireBusinessAccess");

const business = { id: "biz-1", businessName: "Tiny Toes", ownerProfileId: "owner-1" };

beforeEach(() => {
  requireUserMock.mockReset();
  getBusinessForManageMock.mockReset();
});

describe("requireBusinessAccess", () => {
  it("requires sign-in before looking anything up", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect"));
    await expect(requireBusinessAccess("biz-1", "/x")).rejects.toThrow("redirect");
    expect(getBusinessForManageMock).not.toHaveBeenCalled();
  });

  it("a business the caller can't see (RLS returns null) is an ordinary 404 — the URL id is never an authorization claim", async () => {
    requireUserMock.mockResolvedValue({ id: "stranger" });
    getBusinessForManageMock.mockResolvedValue(null);
    await expect(requireBusinessAccess("someone-elses-biz", "/x")).rejects.toThrow(NotFoundSignal);
  });

  it("the owner is identified by owner_profile_id", async () => {
    requireUserMock.mockResolvedValue({ id: "owner-1" });
    getBusinessForManageMock.mockResolvedValue(business);
    expect((await requireBusinessAccess("biz-1", "/x")).isOwner).toBe(true);
  });

  it("any other authorized user (a business member) is not the owner", async () => {
    requireUserMock.mockResolvedValue({ id: "member-1" });
    getBusinessForManageMock.mockResolvedValue(business);
    const access = await requireBusinessAccess("biz-1", "/x");
    expect(access.isOwner).toBe(false);
    expect(access.business.id).toBe("biz-1");
  });
});
