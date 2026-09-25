import { AlertTriangle, Check, Info } from "./icons";

export type AlertTone = "info" | "success" | "danger";

const TONE_STYLES: Record<AlertTone, string> = {
  info: "bg-brand-light-sage text-brand-ink",
  success: "bg-brand-sage-dark/15 text-brand-sage-dark",
  danger: "bg-brand-danger/10 text-brand-danger",
};

const TONE_ICONS: Record<AlertTone, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  info: Info,
  success: Check,
  danger: AlertTriangle,
};

/**
 * A presentational inline alert/toast surface — this codebase has no
 * global toast/notification state manager yet, so this is the visual
 * building block a future phase wires up to one, not a wired-up
 * notification system itself. `role="status"` (non-danger) or
 * `role="alert"` (danger) so assistive tech announces it without the
 * page needing to manage focus — colour is never the only signal
 * (an icon + text always accompany the tone).
 */
export function Alert({ tone = "info", children }: { tone?: AlertTone; children: React.ReactNode }) {
  const Icon = TONE_ICONS[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-2 rounded-input px-3.5 py-3 text-body-small ${TONE_STYLES[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden={true} />
      <div>{children}</div>
    </div>
  );
}
