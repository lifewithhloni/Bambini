"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * SellerNav's business-scoped sibling (same look, same "in-page secondary
 * nav, never a second BottomNav" role). Every link is built from the one
 * businessId the page was already authorized for server-side — this is
 * navigation only; each destination page independently re-checks
 * membership/ownership itself, so a hand-edited URL can't reach another
 * business's pages just because this component rendered.
 */
export function BusinessNav({ businessId }: { businessId: string }) {
  const pathname = usePathname();
  const base = `/account/business/${businessId}`;
  const items = [
    { href: base, label: "Dashboard" },
    { href: `${base}/listings`, label: "Listings" },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/messages`, label: "Messages" },
    { href: `${base}/payouts`, label: "Payouts" },
    { href: `${base}/team`, label: "Team" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <nav aria-label="Business sections" className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.href === base ? pathname === base : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-body-small font-medium transition-colors duration-150 ease-bambini ${
              active ? "bg-bambini-forest text-white" : "bg-brand-surface text-brand-ink hover:bg-brand-cream"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
