import { Badge } from "@/components/ui/Badge";

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
  return <Badge tone="info">{conditionLabel(condition)}</Badge>;
}
