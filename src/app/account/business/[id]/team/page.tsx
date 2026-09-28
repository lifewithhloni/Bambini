import { requireBusinessAccess } from "@/server/business/requireBusinessAccess";
import { getBusinessMembers } from "@/server/business/getBusinessMembers";
import { BusinessHeader } from "@/components/business/BusinessHeader";
import { RemoveMemberButton } from "./RemoveMemberButton";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { User } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Two authority levels only, matching the schema: the owner
 * (businesses.owner_profile_id) and everyone else who is a business
 * member. Members are all listed identically — business_members.role is
 * never read or shown, since no policy or function treats it as a
 * permission tier. Removal is owner-only (RLS-enforced); adding a team
 * member is supported by the database (business_members_insert_owner) but
 * is not exposed here yet, because it needs a way to identify another
 * user and no safe lookup exists — building one would be a user-enumeration
 * surface, which isn't this phase's call to make.
 */
export default async function BusinessTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business, isOwner } = await requireBusinessAccess(id, `/account/business/${id}/team`);
  const members = await getBusinessMembers(id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
      <BusinessHeader businessId={business.id} businessName={business.businessName} verificationStatus={business.verificationStatus} isOwner={isOwner} />

      <div>
        <h2 className="text-heading-card text-brand-ink">Team</h2>
        <p className="mt-1 text-body-small text-brand-muted">
          Team members can manage this business&apos;s listings and orders. Only the owner can request payouts and change business settings.
        </p>
      </div>

      {!isOwner && <Alert tone="info">Only the business owner can remove team members.</Alert>}

      {members.length === 0 ? (
        <EmptyState icon={User} title="No team members yet" description="It's just the owner for now." />
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <Card key={m.profileId} elevation="subtle">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.displayName} />
                  <span className="truncate text-body-small font-medium text-brand-ink">{m.displayName}</span>
                </div>
                {isOwner && <RemoveMemberButton businessId={business.id} profileId={m.profileId} displayName={m.displayName} />}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
