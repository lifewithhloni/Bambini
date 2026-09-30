import "server-only";
import { requireAdmin } from "@/server/auth/requireAdmin";
import { listPendingVerifications } from "@/server/verification/adminVerifications";
import { listPendingBusinessVerifications } from "@/server/business/verification/adminBusinessVerifications";
import { listDisputes } from "@/server/disputes/adminDisputes";
import { listPayouts } from "@/server/payouts/adminPayouts";
import { listStuckPendingDeliveries } from "@/server/delivery/adminStuckDeliveries";

export type AdminOverviewCounts = {
  pendingIdentityVerifications: number;
  pendingBusinessVerifications: number;
  openDisputes: number;
  pendingPayouts: number;
  deliveryIssues: number;
};

const OPEN_DISPUTE_STATUSES = new Set(["open", "under_review"]);

/**
 * Pure counting logic, kept separate from the data fetch below so it's
 * directly unit-testable without a server/DB harness. Takes exactly the
 * shapes the five existing admin list functions already return — no new
 * field, no invented statistic. "Open disputes" is open + under_review
 * (both still need admin attention); a resolved/closed dispute doesn't.
 * "Pending payouts" is payout_status = 'pending' (the default, and the
 * state a payout sits in until an admin marks it paid/failed) — matches
 * the enum's own default in 20260920090600_payouts_and_refunds.sql.
 */
export function summarizeAdminOverview(inputs: {
  identityVerifications: unknown[];
  businessVerifications: unknown[];
  disputes: { status: string }[];
  payouts: { status: string }[];
  stuckDeliveries: unknown[];
}): AdminOverviewCounts {
  return {
    pendingIdentityVerifications: inputs.identityVerifications.length,
    pendingBusinessVerifications: inputs.businessVerifications.length,
    openDisputes: inputs.disputes.filter((d) => OPEN_DISPUTE_STATUSES.has(d.status)).length,
    pendingPayouts: inputs.payouts.filter((p) => p.status === "pending").length,
    deliveryIssues: inputs.stuckDeliveries.length,
  };
}

/**
 * Admin-only (requireAdmin() 404s otherwise, same as every other admin
 * page). Every count is derived from the exact same admin-gated functions
 * the individual admin sections already use and already have their own
 * tests/RLS coverage for (listPendingVerifications, listDisputes, etc.) —
 * this never runs a new query or duplicates their filtering logic, only
 * reuses their result and counts it.
 */
export async function getAdminOverview(): Promise<AdminOverviewCounts> {
  await requireAdmin("/admin");

  const [identityVerifications, businessVerifications, disputes, payouts, stuckDeliveries] = await Promise.all([
    listPendingVerifications(),
    listPendingBusinessVerifications(),
    listDisputes(),
    listPayouts(),
    listStuckPendingDeliveries(),
  ]);

  return summarizeAdminOverview({ identityVerifications, businessVerifications, disputes, payouts, stuckDeliveries });
}
