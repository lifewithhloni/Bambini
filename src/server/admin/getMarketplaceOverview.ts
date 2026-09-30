import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

export type MarketplaceOverviewCounts = {
  totalAccounts: number;
  verifiedAccounts: number;
  businessAccounts: number;
  activeListings: number;
  completedOrders: number;
};

/**
 * Admin-only (requireAdmin() 404s otherwise) — a quick platform-size
 * snapshot, independent of the "needs attention" queue counts in
 * getAdminOverview.ts (that file is untouched by this feature). Every
 * number is a plain head-only count under the admin's own authenticated
 * session (RLS already permits an admin to read every row of each of
 * these tables — see profiles_select_own_or_admin, businesses_select_member_or_admin,
 * products_select_active_or_owner_or_admin, orders_select_participant_or_admin),
 * never the service-role/admin client.
 *
 * Definitions, each chosen to match an existing, already-established
 * meaning rather than invent a new one:
 * - totalAccounts: every row of profiles (1:1 with auth.users).
 * - verifiedAccounts: profiles.identity_verification = 'verified' — the
 *   same trigger-synced field (sync_profile_identity_verification(),
 *   20260928090000_identity_account_verification.sql) already shown as
 *   the "Verified" badge elsewhere in the app.
 * - businessAccounts: every row of businesses, regardless of its own
 *   verification_status — one row per business; business_members (staff)
 *   never creates an additional businesses row, so staff can't inflate
 *   this count.
 * - activeListings: products.status = 'published' — the current enum
 *   label (renamed from 'active' by 20260921090000_align_listing_labels.sql;
 *   the literal 'active' is no longer a valid value to filter on — the
 *   RLS policy above still reads "status = 'active'" in its stored SQL
 *   text, but Postgres compares enums by OID, so that expression already
 *   means 'published' post-rename; only the literal source text is
 *   stale, not its meaning).
 * - completedOrders: orders.status = 'completed'.
 *
 * On a query failure, that one count is 0 rather than fabricated —
 * matching the same "return an empty/zero result on error" convention
 * every sibling admin list function in this codebase already uses (see
 * listPendingVerifications()'s own `if (error || !data) return []`).
 */
export async function getMarketplaceOverview(): Promise<MarketplaceOverviewCounts> {
  await requireAdmin("/admin");
  const supabase = await createClient();

  const [totalAccounts, verifiedAccounts, businessAccounts, activeListings, completedOrders] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("identity_verification", "verified"),
    supabase.from("businesses").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "completed"),
  ]);

  return {
    totalAccounts: totalAccounts.count ?? 0,
    verifiedAccounts: verifiedAccounts.count ?? 0,
    businessAccounts: businessAccounts.count ?? 0,
    activeListings: activeListings.count ?? 0,
    completedOrders: completedOrders.count ?? 0,
  };
}
