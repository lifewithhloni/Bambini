import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/auth/requireAdmin";

const SIGNED_URL_EXPIRY_SECONDS = 15 * 60; // short-lived — a review page, not a persistent gallery

export type PendingVerification = {
  id: string;
  profileId: string;
  profileName: string | null;
  documentType: string;
  createdAt: string;
};

/** Admin-only (requireAdmin() 404s otherwise) — RLS's own identity_verifications_select_own_or_admin policy is the actual data boundary; this is the list the minimal review page renders. */
export async function listPendingVerifications(): Promise<PendingVerification[]> {
  await requireAdmin("/admin/verifications");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("identity_verifications")
    .select("id, profile_id, document_type, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const profileIds = Array.from(new Set(data.map((d) => d.profile_id)));
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", profileIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return data.map((d) => ({
    id: d.id,
    profileId: d.profile_id,
    profileName: nameById.get(d.profile_id) ?? null,
    documentType: d.document_type,
    createdAt: d.created_at,
  }));
}

export type VerificationSubmissionDetail = {
  id: string;
  profileId: string;
  profileName: string | null;
  idNumber: string;
  documentSignedUrl: string | null;
  status: string;
  createdAt: string;
};

/**
 * A signed URL is minted using the ADMIN's own session — RLS's
 * verification_documents_storage_select_own_or_admin policy is what
 * actually allows an admin to read someone else's document, this call
 * doesn't grant anything on its own. Never a stable/public URL, and the
 * raw storage path itself is never sent to the browser.
 */
export async function getVerificationSubmissionDetail(submissionId: string): Promise<VerificationSubmissionDetail | null> {
  await requireAdmin(`/admin/verifications/${submissionId}`);
  const supabase = await createClient();

  const { data: submission, error } = await supabase
    .from("identity_verifications")
    .select("id, profile_id, id_number, document_storage_path, status, created_at")
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !submission) return null;

  const [{ data: profile }, { data: signed }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", submission.profile_id).maybeSingle(),
    supabase.storage.from("verification-documents").createSignedUrl(submission.document_storage_path, SIGNED_URL_EXPIRY_SECONDS),
  ]);

  return {
    id: submission.id,
    profileId: submission.profile_id,
    profileName: profile?.full_name ?? null,
    idNumber: submission.id_number,
    documentSignedUrl: signed?.signedUrl ?? null,
    status: submission.status,
    createdAt: submission.created_at,
  };
}
