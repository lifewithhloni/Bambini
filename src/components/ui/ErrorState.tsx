import { AlertTriangle } from "./icons";
import { Button } from "./Button";

/** The shared "something went wrong" shape for a section/page, distinct from EmptyState (this is a failure, not an absence of data). */
export function ErrorState({
  title = "Something went wrong",
  description = "Please try again in a moment.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-brand-border bg-brand-surface px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-danger/10">
        <AlertTriangle className="h-6 w-6 text-brand-danger" aria-hidden={true} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-heading-card text-brand-ink">{title}</p>
        <p className="text-body-small text-brand-muted">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
