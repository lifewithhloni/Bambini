import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { isPhoneVerificationEnabled } from "@/server/phone/config";
import { e164FromAuthPhone } from "@/server/phone/normalizePhone";

export type IdentityStatus = "not_submitted" | "pending" | "verified" | "rejected";

export type VerificationStatus = {
  emailConfirmed: boolean;
  phoneConfirmed: boolean;
  /**
   * Whether the phone-verification FLOW is offered (PHONE_VERIFICATION_ENABLED
   * — i.e. an SMS provider is connected). Purely a UI gate: it never makes
   * phoneConfirmed true and never affects canTransact.
   */
  phoneVerificationAvailable: boolean;
  /** The phone Supabase Auth holds (E.164), or null. Confirmed only if phoneConfirmed. */
  authPhone: string | null;
  /** A number awaiting its SMS code (Auth's new_phone), or null. Not yet verified. */
  pendingPhone: string | null;
  identityStatus: IdentityStatus;
  rejectionReason: string | null;
  canTransact: boolean;
};

/**
 * Email/phone confirmation (and the phone number itself) comes straight off requireUser()'s own
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
    phoneVerificationAvailable: isPhoneVerificationEnabled(),
    authPhone: e164FromAuthPhone(user.phone),
    pendingPhone: e164FromAuthPhone(user.new_phone),
    identityStatus,
    rejectionReason: identityStatus === "rejected" ? (latest?.notes ?? null) : null,
    canTransact: canTransactData === true,
  };
}
