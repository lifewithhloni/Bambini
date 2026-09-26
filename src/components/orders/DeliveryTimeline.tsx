import { buildDeliveryTimeline } from "@/lib/delivery/deliveryTimeline";
import { Check } from "@/components/ui/icons";

/**
 * A simple buyer-facing milestone list — only ever built from the
 * delivery order's actual current status (see deliveryTimeline.ts),
 * never a fabricated timestamped history. Renders nothing for a
 * collection order, a delivery order with no tracking yet, or a
 * failed/cancelled delivery (the caller shows those states separately).
 */
export function DeliveryTimeline({ status }: { status: string }) {
  const steps = buildDeliveryTimeline(status);
  if (steps.length === 0) return null;

  return (
    <ol aria-label="Delivery progress" className="flex flex-col">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-brand-sage-dark" : "bg-brand-border"}`}
              aria-hidden="true"
            >
              {step.done && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
            </span>
            {i < steps.length - 1 && <span className={`h-6 w-0.5 ${step.done ? "bg-brand-sage-dark" : "bg-brand-border"}`} aria-hidden="true" />}
          </div>
          <span className={`text-body-small ${i < steps.length - 1 ? "pb-6" : ""} ${step.done ? "font-medium text-brand-ink" : "text-brand-muted"}`}>
            {step.label}
            {step.done && i === steps.filter((s) => s.done).length - 1 && <span className="sr-only"> — current status</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
