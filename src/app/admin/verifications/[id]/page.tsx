import Link from "next/link";
import { notFound } from "next/navigation";
import { getVerificationSubmissionDetail } from "@/server/verification/adminVerifications";
import { maskIdNumber } from "@/server/verification/idNumberValidation";
import { ReviewActions } from "./ReviewActions";

export const dynamic = "force-dynamic";

export default async function AdminVerificationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await getVerificationSubmissionDetail(id);
  if (!submission) notFound();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 sm:py-12">
      <Link href="/admin/verifications" className="text-sm text-brand-muted hover:underline">
        ← Pending verifications
      </Link>

      <h1 className="text-xl font-semibold text-brand-ink">{submission.profileName ?? "Unknown user"}</h1>

      <div className="flex flex-col gap-2 rounded-lg border border-brand-border bg-white p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">ID number</span>
          <span className="text-brand-ink">{maskIdNumber(submission.idNumber)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-muted">Submitted</span>
          <span className="text-brand-ink">{new Date(submission.createdAt).toLocaleString()}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-brand-ink">Submitted document</p>
        {submission.documentSignedUrl ? (
          <a
            href={submission.documentSignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-brand-sage-dark px-4 py-2 text-center text-sm font-medium text-brand-ink hover:bg-brand-bg"
          >
            View document (opens in a new tab, link expires shortly)
          </a>
        ) : (
          <p className="text-sm text-brand-danger">Could not generate a link to the document.</p>
        )}
      </div>

      {submission.status === "pending" ? (
        <ReviewActions submissionId={submission.id} />
      ) : (
        <p className="rounded-lg bg-brand-border px-3 py-2 text-sm text-brand-ink">Already reviewed — status: {submission.status}.</p>
      )}
    </div>
  );
}
