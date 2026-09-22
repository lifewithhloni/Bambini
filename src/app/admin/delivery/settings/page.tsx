import { getCurrentDeliveryMarkupSetting } from "@/server/delivery/adminMarkupSettings";
import { MarkupSettingsForm } from "./MarkupSettingsForm";

// Live admin config — never statically cached.
export const dynamic = "force-dynamic";

/**
 * Deliberately minimal — one setting, one form, per this project's own
 * "do not build a full admin dashboard" convention (see /admin/verifications,
 * /admin/delivery). getCurrentDeliveryMarkupSetting() (requireAdmin()
 * inside) 404s this whole page for anyone who isn't an admin.
 */
export default async function AdminDeliverySettingsPage() {
  const setting = await getCurrentDeliveryMarkupSetting();
  const currentPercentage = setting ? setting.markupPercentageBps / 100 : 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-brand-ink">Delivery pricing</h1>
        <p className="mt-1 text-sm text-brand-muted">
          The percentage Bambini adds on top of the delivery provider&apos;s own cost. The buyer only ever sees the
          marked-up total — the provider&apos;s raw cost is never shown to them.
        </p>
      </div>

      <MarkupSettingsForm currentPercentage={currentPercentage} />

      {setting && (
        <p className="text-xs text-brand-muted">
          Last changed {new Date(setting.effectiveFrom).toLocaleString()}
          {setting.changedByName ? ` by ${setting.changedByName}` : ""}.
        </p>
      )}
    </div>
  );
}
