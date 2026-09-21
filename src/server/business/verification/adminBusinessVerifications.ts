import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

const SIGNED_URL_EXPIRY_SECONDS = 15 * 60;

export type PendingBusinessVerification = {
  id: string;
  businessId: string;
  businessName: string | null;
  documentType: string;
  createdAt: string;
};

/** Mirrors listPendingVerifications() (identity) exactly, scoped to business_verifications. */
export async function listPendingBusinessVerifications(): Promise<PendingBusinessVerification[]> {
  await requireAdmin("/admin/business-verifications");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("business_verifications")
    .select("id, business_id, document_type, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const businessIds = Array.from(new Set(data.map((d) => d.business_id)));
  const { data: businesses } = await supabase.from("businesses").select("id, business_name").in("id", businessIds);
  const nameById = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  return data.map((d) => ({
    id: d.id,
    businessId: d.business_id,
    businessName: nameById.get(d.business_id) ?? null,
    documentType: d.document_type,
    createdAt: d.created_at,
  }));
}

export type BusinessVerificationSubmissionDetail = {
  id: string;
  businessId: string;
  businessName: string | null;
  documentType: string;
  documentSignedUrl: string | null;
  status: string;
  createdAt: string;
};

export async function getBusinessVerificationSubmissionDetail(submissionId: string): Promise<BusinessVerificationSubmissionDetail | null> {
  await requireAdmin(`/admin/business-verifications/${submissionId}`);
  const supabase = await createClient();

  const { data: submission, error } = await supabase
    .from("business_verifications")
    .select("id, business_id, document_type, document_storage_path, status, created_at")
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !submission) return null;

  const [{ data: business }, { data: signed }] = await Promise.all([
    supabase.from("businesses").select("business_name").eq("id", submission.business_id).maybeSingle(),
    supabase.storage.from("verification-documents").createSignedUrl(submission.document_storage_path, SIGNED_URL_EXPIRY_SECONDS),
  ]);

  return {
    id: submission.id,
    businessId: submission.business_id,
    businessName: business?.business_name ?? null,
    documentType: submission.document_type,
    documentSignedUrl: signed?.signedUrl ?? null,
    status: submission.status,
    createdAt: submission.created_at,
  };
}
