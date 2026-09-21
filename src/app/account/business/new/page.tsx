import { requireUser } from "@/server/auth/requireUser";
import { BusinessForm } from "./BusinessForm";

export const dynamic = "force-dynamic";

export default async function NewBusinessPage() {
  await requireUser("/account/business/new");

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Start a business</h1>
        <p className="mt-1 text-sm text-brand-muted">
          You&apos;ll be the owner. New businesses start unverified — submit verification once it&apos;s created to make your
          storefront and listings public.
        </p>
      </div>
      <BusinessForm />
    </div>
  );
}
