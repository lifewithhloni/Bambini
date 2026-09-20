/**
 * Snapshot of a seller's standing, gathered server-side from the DB
 * immediately before evaluation. Never accept these values from the
 * client — cash eligibility gates a payment method, so it must be
 * computed from trusted data only.
 */
export type SellerStanding = {
  isAccountVerified: boolean;
  isIdentityVerified: boolean;
  completedTransactionCount: number;
  ratingAverage: number | null;
  unresolvedDisputeCount: number;
  accountStanding: "good" | "warned" | "suspended";
};

/**
 * Mirrors the `cash_eligibility_criteria` table: each criterion is
 * independently configurable so admins can tune the bar (e.g. raise the
 * minimum completed transactions) without a code change. `evaluate`
 * receives the already-loaded, active criteria rows.
 */
export type CashEligibilityCriterion = {
  key:
    | "min_completed_transactions"
    | "min_rating_average"
    | "requires_account_verification"
    | "requires_identity_verification"
    | "max_unresolved_disputes";
  threshold: number | boolean;
};

export type CashEligibilityResult = {
  eligible: boolean;
  failedCriteria: string[];
};

export function evaluateCashEligibility(
  standing: SellerStanding,
  criteria: CashEligibilityCriterion[],
): CashEligibilityResult {
  if (standing.accountStanding !== "good") {
    return { eligible: false, failedCriteria: ["account_standing"] };
  }

  const failedCriteria: string[] = [];

  for (const criterion of criteria) {
    switch (criterion.key) {
      case "min_completed_transactions":
        if (standing.completedTransactionCount < (criterion.threshold as number)) {
          failedCriteria.push(criterion.key);
        }
        break;
      case "min_rating_average":
        if ((standing.ratingAverage ?? 0) < (criterion.threshold as number)) {
          failedCriteria.push(criterion.key);
        }
        break;
      case "requires_account_verification":
        if (criterion.threshold === true && !standing.isAccountVerified) {
          failedCriteria.push(criterion.key);
        }
        break;
      case "requires_identity_verification":
        if (criterion.threshold === true && !standing.isIdentityVerified) {
          failedCriteria.push(criterion.key);
        }
        break;
      case "max_unresolved_disputes":
        if (standing.unresolvedDisputeCount > (criterion.threshold as number)) {
          failedCriteria.push(criterion.key);
        }
        break;
    }
  }

  return { eligible: failedCriteria.length === 0, failedCriteria };
}
