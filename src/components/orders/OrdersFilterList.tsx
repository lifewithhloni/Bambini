"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { OrderCard } from "./OrderCard";
import { orderMatchesFilter, type OrderFilter } from "@/lib/orders/orderBucket";
import type { OrderSummary } from "@/server/orders/getMyOrders";

const FILTERS: { key: OrderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];

/**
 * Filters purely client-side over the already-fetched, already-authoritative
 * order list (getMyOrders(), server-rendered by the parent page) — no
 * second network call, no server-side filtering endpoint. The buyer's own
 * order count is small enough that this is simpler and just as correct as
 * a paginated/filtered query would be, and it can never show an order
 * this buyer doesn't own, since the list it filters was never anything
 * but their own to begin with.
 */
export function OrdersFilterList({ orders, imageUrls }: { orders: OrderSummary[]; imageUrls: Record<string, string> }) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const filtered = orders.filter((o) => orderMatchesFilter(o.status, filter));

  return (
    <div className="flex flex-col gap-4">
      {/* A group of toggle buttons (Chip's own native aria-pressed
          semantics), not an ARIA tablist — a real tablist needs roving
          tabindex/arrow-key navigation this doesn't implement, so
          claiming role="tab" here would be a false accessibility
          promise rather than a genuine one. */}
      <div aria-label="Filter orders" className="flex gap-2">
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
            <OrderCard key={order.id} order={order} imageUrl={order.coverImagePath ? (imageUrls[order.coverImagePath] ?? null) : null} />
          ))}
        </div>
      )}
    </div>
  );
}
