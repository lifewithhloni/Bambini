import { describe, expect, it } from "vitest";
import {
  evaluateCashEligibility,
  type CashEligibilityCriterion,
  type SellerStanding,
} from "./evaluateCashEligibility";

const defaultCriteria: CashEligibilityCriterion[] = [
  { key: "min_completed_transactions", threshold: 3 },
  { key: "min_rating_average", threshold: 4 },
  { key: "requires_account_verification", threshold: true },
  { key: "requires_identity_verification", threshold: true },
  { key: "max_unresolved_disputes", threshold: 0 },
];

const eligibleSeller: SellerStanding = {
  isAccountVerified: true,
  isIdentityVerified: true,
  completedTransactionCount: 5,
  ratingAverage: 4.5,
  unresolvedDisputeCount: 0,
  accountStanding: "good",
};

describe("evaluateCashEligibility", () => {
  it("approves a seller who meets every criterion", () => {
    const result = evaluateCashEligibility(eligibleSeller, defaultCriteria);
    expect(result).toEqual({ eligible: true, failedCriteria: [] });
  });

  it("rejects a brand-new seller who has never transacted", () => {
    const result = evaluateCashEligibility(
      { ...eligibleSeller, completedTransactionCount: 0, ratingAverage: null },
      defaultCriteria,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedCriteria).toContain("min_completed_transactions");
    expect(result.failedCriteria).toContain("min_rating_average");
  });

  it("rejects an unverified identity even with a strong track record", () => {
    const result = evaluateCashEligibility(
      { ...eligibleSeller, isIdentityVerified: false },
      defaultCriteria,
    );
    expect(result.failedCriteria).toEqual(["requires_identity_verification"]);
  });

  it("rejects any seller with an unresolved dispute", () => {
    const result = evaluateCashEligibility(
      { ...eligibleSeller, unresolvedDisputeCount: 1 },
      defaultCriteria,
    );
    expect(result.failedCriteria).toEqual(["max_unresolved_disputes"]);
  });

  it("short-circuits on bad account standing regardless of other criteria", () => {
    const result = evaluateCashEligibility(
      { ...eligibleSeller, accountStanding: "suspended" },
      defaultCriteria,
    );
    expect(result).toEqual({ eligible: false, failedCriteria: ["account_standing"] });
  });
});
