import type { ComponentType } from "react";

/**
 * The shared "nothing here yet" shape — e.g. "No saved items yet",
 * "No listings found", "No messages yet", "No orders yet". A future
 * phase wires this into each real empty list; this phase only
 * establishes the reusable shell so every empty state in the product
 * looks and behaves the same way.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-brand-border bg-brand-surface px-6 py-12 text-center">
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-cream">
          <Icon className="h-6 w-6 text-brand-sage-dark" aria-hidden={true} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-heading-card text-brand-ink">{title}</p>
        {description && <p className="text-body-small text-brand-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
