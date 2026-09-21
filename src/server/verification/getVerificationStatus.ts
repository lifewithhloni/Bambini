import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";

/**
 * No SMS provider is configured anywhere in this project
 * (supabase/config.toml has no [auth.sms] section) — Supabase's phone-OTP
 * flow cannot actually run without one. This is a deliberate, explicit
 * fact the UI surfaces (per the Phase 5 brief: "do not pretend a phone
 * is verified... clearly indicate that phone verification is currently
 * unavailable/not configured"), not a placeholder to quietly remove
 * later. phone_confirmed_at will genuinely be null for every real
 * signup until a provider is added — see DECISIONS.md.
 */
export const PHONE_VERIFICATION_AVAILABLE = false;

export type IdentityStatus = "not_submitted" | "pending" | "verified" | "rejected";

export type VerificationStatus = {
  emailConfirmed: boolean;
  phoneConfirmed: boolean;
  identityStatus: IdentityStatus;
  rejectionReason: string | null;
  canTransact: boolean;
};

/**
 * Email/phone confirmation comes straight off requireUser()'s own
 * server-revalidated Auth session (getUser(), not a decoded cookie) —
 * no database round-trip, and nothing here is a stored/cacheable value a
 * client could ever influence. Identity status is the latest
 * identity_verifications row for this user, readable under its own
 * owner-or-admin RLS policy. canTransact mirrors can_transact() exactly
 * (it's not re-derived independently here — see the RPC call below) so
 * this page can never show a state that disagrees with what
 * create_order()/the publish trigger will actually enforce.
 */
export async function getVerificationStatus(): Promise<VerificationStatus> {
  const user = await requireUser("/account/verification");
  const supabase = await createClient();

  const [{ data: latest }, { data: canTransactData }] = await Promise.all([
    supabase
      .from("identity_verifications")
      .select("status, notes")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("can_transact"),
  ]);

  // identity_verifications.status shares the same DB enum as
  // profiles.account_verification (unverified|pending|verified|rejected)
  // for schema reuse, but a real submission row is never actually
  // 'unverified' — nothing ever writes that value to this table (its
  // own default is 'pending'). Treated the same as "no row at all" if
  // it were ever somehow encountered.
  const identityStatus: IdentityStatus = !latest || latest.status === "unverified" ? "not_submitted" : latest.status;

  return {
    emailConfirmed: user.email_confirmed_at != null,
    phoneConfirmed: user.phone_confirmed_at != null,
    identityStatus,
    rejectionReason: identityStatus === "rejected" ? (latest?.notes ?? null) : null,
    canTransact: canTransactData === true,
  };
}
