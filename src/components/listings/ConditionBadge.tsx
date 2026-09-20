const LABELS: Record<string, string> = {
  like_new: "Like New",
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
};

export function conditionLabel(condition: string): string {
  return LABELS[condition] ?? condition;
}

export function ConditionBadge({ condition }: { condition: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-sage/20 px-2.5 py-0.5 text-xs font-medium text-brand-ink">
      {conditionLabel(condition)}
    </span>
  );
}
