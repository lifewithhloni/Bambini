import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { summarizeAdminOverview } = await import("./getAdminOverview");

describe("summarizeAdminOverview — pure counting logic", () => {
  it("counts identity/business verifications and stuck deliveries by list length", () => {
    const result = summarizeAdminOverview({
      identityVerifications: [{}, {}, {}],
      businessVerifications: [{}],
      disputes: [],
      payouts: [],
      stuckDeliveries: [{}, {}],
    });
    expect(result.pendingIdentityVerifications).toBe(3);
    expect(result.pendingBusinessVerifications).toBe(1);
    expect(result.deliveryIssues).toBe(2);
  });

  it("counts open disputes as open + under_review, never resolved/closed ones", () => {
    const result = summarizeAdminOverview({
      identityVerifications: [],
      businessVerifications: [],
      disputes: [
        { status: "open" },
        { status: "under_review" },
        { status: "resolved_buyer" },
        { status: "resolved_seller" },
        { status: "resolved_partial" },
        { status: "closed" },
      ],
      payouts: [],
      stuckDeliveries: [],
    });
    expect(result.openDisputes).toBe(2);
  });

  it("counts pending payouts only — never processing/paid/failed", () => {
    const result = summarizeAdminOverview({
      identityVerifications: [],
      businessVerifications: [],
      disputes: [],
      payouts: [{ status: "pending" }, { status: "pending" }, { status: "processing" }, { status: "paid" }, { status: "failed" }],
      stuckDeliveries: [],
    });
    expect(result.pendingPayouts).toBe(2);
  });

  it("returns all zeros for an all-clear admin queue — never a fabricated non-zero count", () => {
    const result = summarizeAdminOverview({ identityVerifications: [], businessVerifications: [], disputes: [], payouts: [], stuckDeliveries: [] });
    expect(result).toEqual({
      pendingIdentityVerifications: 0,
      pendingBusinessVerifications: 0,
      openDisputes: 0,
      pendingPayouts: 0,
      deliveryIssues: 0,
    });
  });
});
