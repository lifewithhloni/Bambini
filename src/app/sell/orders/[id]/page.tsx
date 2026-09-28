import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/requireUser";
import { getOrder } from "@/server/orders/getOrder";
import { viewerIsOrderSeller } from "@/server/orders/viewerIsOrderSeller";
import { SellerOrderDetailSections } from "@/components/orders/SellerOrderDetailSections";
import { ChevronLeft } from "@/components/ui/icons";

// One specific signed-in seller's own order — never statically cached.
export const dynamic = "force-dynamic";

export default async function SellerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/sell/orders/${id}`);

  const order = await getOrder(id);
  if (!order) notFound();

  const isSeller = await viewerIsOrderSeller(order, user.id);
  if (!isSeller) notFound();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-12">
      <Link href="/sell/orders" className="inline-flex w-fit items-center gap-1 text-body-small font-medium text-brand-muted hover:text-bambini-forest">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to orders
      </Link>
      <h1 className="text-heading-page text-brand-ink">Order details</h1>
      <SellerOrderDetailSections order={order} />
    </div>
  );
}
