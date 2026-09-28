import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getInbox } from "@/server/messaging/getInbox";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { InboxList } from "@/components/messaging/InboxList";
import { EmptyState } from "@/components/ui/EmptyState";
import { MessageCircle } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * This one business's conversations only. Access follows the established
 * business model — the owner or any business member, exactly like this
 * business's orders and listings (business_members.role is not consulted)
 * — and the inbox is filtered to this business_id, so it never includes
 * the member's personal conversations or another business's.
 */
export default async function BusinessMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}/messages`);
  const threads = await getInbox(userId, { kind: "business", businessId: id });

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />
      <h2 className="text-heading-card text-brand-ink">Messages</h2>
      {threads.length === 0 ? (
        <EmptyState icon={MessageCircle} title="No messages yet" description="When a buyer messages about one of your business's listings, it will appear here." />
      ) : (
        <InboxList threads={threads} hrefBase={`/account/business/${business.id}/messages`} />
      )}
    </div>
  );
}
