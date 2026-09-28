"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { SellerOrderCard } from "./SellerOrderCard";
import { sellerOrderMatchesFilter, type SellerOrderFilter } from "@/lib/orders/sellerOrderBucket";
import type { SellerOrderSummary } from "@/server/orders/getSellerOrders";

const FILTERS: { key: SellerOrderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Needs action" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];

/** Filters purely client-side over the already-fetched, already-authorized order list — same pattern as the buyer-side OrdersFilterList.tsx. */
export function SellerOrdersFilterList({ orders, imageUrls }: { orders: SellerOrderSummary[]; imageUrls: Record<string, string> }) {
  const [filter, setFilter] = useState<SellerOrderFilter>("all");
  const filtered = orders.filter((o) =>
    sellerOrderMatchesFilter({ status: o.status, paymentMethod: o.payment_method, fulfilmentType: o.fulfilment_type, hasActiveDispute: o.hasActiveDispute }, filter),
  );

  return (
    <div className="flex flex-col gap-4">
      <div aria-label="Filter orders" className="flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-body-small text-brand-muted">No orders in this view.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((order) => (
            <SellerOrderCard key={order.id} order={order} imageUrl={order.coverImagePath ? (imageUrls[order.coverImagePath] ?? null) : null} />
          ))}
        </div>
      )}
    </div>
  );
}
