import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getOrderMock = vi.fn();
vi.mock("./getOrder", () => ({ getOrder: getOrderMock }));

const { getBusinessOrderDetail } = await import("./getBusinessOrderDetail");

beforeEach(() => getOrderMock.mockReset());

describe("getBusinessOrderDetail", () => {
  it("returns the order when it genuinely belongs to the requested business", async () => {
    const order = { id: "o1", business_id: "biz-1", seller_profile_id: null };
    getOrderMock.mockResolvedValue(order);
    expect(await getBusinessOrderDetail("biz-1", "o1")).toBe(order);
  });

  it("business ID / order ID mismatch: a valid business id paired with ANOTHER business's order returns null, exactly like a missing order", async () => {
    getOrderMock.mockResolvedValue({ id: "o1", business_id: "biz-2", seller_profile_id: null });
    expect(await getBusinessOrderDetail("biz-1", "o1")).toBeNull();
  });

  it("a personal seller's order (business_id null) is never reachable through a business route", async () => {
    getOrderMock.mockResolvedValue({ id: "o1", business_id: null, seller_profile_id: "parent-1" });
    expect(await getBusinessOrderDetail("biz-1", "o1")).toBeNull();
  });

  it("returns null when the order doesn't exist or isn't visible to the caller (getOrder is RLS-scoped)", async () => {
    getOrderMock.mockResolvedValue(null);
    expect(await getBusinessOrderDetail("biz-1", "missing")).toBeNull();
  });

  it("reads the order through the one existing getOrder() with only the order id — the business id is compared, never used to widen the read", async () => {
    getOrderMock.mockResolvedValue(null);
    await getBusinessOrderDetail("biz-1", "o1");
    expect(getOrderMock).toHaveBeenCalledWith("o1");
  });
});
