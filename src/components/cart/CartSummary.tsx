import { formatCentsAsRand } from "@/server/listings/price";
import { calculateSubtotalCents, countAvailable } from "@/lib/cart/cartMath";
import type { CartLine } from "@/server/cart/getCartListings";

/**
 * This is a presentation of current listing prices only: no delivery
 * fee, no commission, no final total — those are computed server-side
 * at checkout (Phase 12B/12C), never here. The actual sum/count logic
 * lives in cartMath.ts (pure, unit-tested) rather than inline here.
 */
export function CartSummary({ lines }: { lines: CartLine[] }) {
  const availableCount = countAvailable(lines);
  const subtotalCents = calculateSubtotalCents(lines);

  return (
    <div className="flex flex-col gap-2 rounded-card bg-brand-surface p-4 shadow-subtle">
      <div className="flex items-center justify-between">
        <span className="text-body-small text-brand-muted">
          Subtotal ({availableCount} item{availableCount === 1 ? "" : "s"})
        </span>
        <span className="text-price text-brand-ink">{formatCentsAsRand(subtotalCents)}</span>
      </div>
      <p className="text-caption text-brand-muted">
        Delivery and any fees are calculated separately when you buy each item — this isn&apos;t your final total.
      </p>
      {availableCount > 1 && (
        <p className="text-caption text-brand-muted">
          Each item is bought and paid for separately — there&apos;s no single checkout for your whole cart yet.
        </p>
      )}
    </div>
  );
}
