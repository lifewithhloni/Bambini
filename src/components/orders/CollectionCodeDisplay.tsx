import { getMyCollectionCode } from "@/server/orders/getMyCollectionCode";

/**
 * Buyer-only reveal of their collection code, via get_my_collection_code()
 * (SECURITY DEFINER, re-validates auth.uid() = orders.buyer_id server-side
 * — see 20260927090000_cash_collection_transactions.sql). Renders nothing
 * if the code can't be retrieved (wrong caller, order not at the right
 * stage) rather than showing an error — the parent page already gates
 * when this is rendered.
 */
export async function CollectionCodeDisplay({ orderId }: { orderId: string }) {
  const code = await getMyCollectionCode(orderId);
  if (!code) return null;

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-brand-sage-dark/40 bg-brand-sage/10 p-4 text-center">
      <p className="text-xs font-medium text-brand-muted">Show this code to the seller when you collect</p>
      <p className="text-2xl font-semibold tracking-[0.3em] text-brand-ink">{code}</p>
    </div>
  );
}
