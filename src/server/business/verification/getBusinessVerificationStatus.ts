import { createClient } from "@/lib/supabase/server";

export type BusinessIdentityStatus = "not_submitted" | "pending" | "verified" | "rejected";

export type BusinessVerificationStatus = {
  status: BusinessIdentityStatus;
  rejectionReason: string | null;
};

/** Mirrors src/server/verification/getVerificationStatus.ts's identity half exactly, scoped to a business's own submission history instead of a profile's. */
export async function getBusinessVerificationStatus(businessId: string): Promise<BusinessVerificationStatus> {
  const supabase = await createClient();

  const { data: latest } = await supabase
    .from("business_verifications")
    .select("status, notes")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const status: BusinessIdentityStatus = !latest || latest.status === "unverified" ? "not_submitted" : latest.status;

  return {
    status,
    rejectionReason: status === "rejected" ? (latest?.notes ?? null) : null,
  };
}
