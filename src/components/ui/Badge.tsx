import { badgeVariants, type BadgeTone } from "@/lib/ui/variants";

export function Badge({ tone, className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return <span className={badgeVariants({ tone, className })}>{children}</span>;
}
