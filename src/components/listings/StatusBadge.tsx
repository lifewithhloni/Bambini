const STYLES: Record<string, string> = {
  draft: "bg-brand-border text-brand-ink",
  published: "bg-brand-sage/30 text-brand-ink",
  archived: "bg-brand-muted/20 text-brand-muted",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-brand-border text-brand-ink"}`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
