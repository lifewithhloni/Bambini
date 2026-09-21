import { requireUser } from "@/server/auth/requireUser";
import { getCategoryOptions } from "@/server/categories/getCategories";
import { getMyBusinesses } from "@/server/business/getMyBusinesses";
import { CreateListingForm } from "./CreateListingForm";

export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  const user = await requireUser("/sell/new");
  const [categories, businesses] = await Promise.all([getCategoryOptions(), getMyBusinesses(user.id)]);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Sell something</h1>
        <p className="mt-1 text-sm text-brand-muted">Give it a good home — and a fair price.</p>
      </div>
      <CreateListingForm categories={categories} businesses={businesses} />
    </div>
  );
}
