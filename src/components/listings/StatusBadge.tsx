import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/lib/ui/variants";

const TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  published: "success",
  archived: "neutral",
  sold: "info",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
  sold: "Sold",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{LABELS[status] ?? status}</Badge>;
}
