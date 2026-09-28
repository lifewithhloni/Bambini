"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/sell", label: "Dashboard" },
  { href: "/sell/listings", label: "Listings" },
  { href: "/sell/orders", label: "Orders" },
  { href: "/account/messages", label: "Messages" },
  { href: "/sell/payouts", label: "Payouts" },
] as const;

/**
 * A secondary, in-page nav for moving between the seller sections (Messages
 * is the personal inbox at /account/messages — one inbox for the buyer and
 * seller sides of a person's conversations, with no counts shown) —
 * distinct from BottomNav (which already has its own "Sell" tab pointing
 * at /sell and stays as the global mobile nav; this never duplicates or
 * competes with it). Shown only on the section-level pages
 * (/sell, /sell/listings, /sell/orders, /sell/payouts), not on focused
 * single-task flows like /sell/new, /sell/[id]/edit, or /sell/orders/[id]
 * — the same "a focused task doesn't need surrounding chrome" precedent
 * /checkout already established by hiding BottomNav on itself.
 */
export function SellerNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Seller sections" className="flex gap-1 overflow-x-auto">
      {ITEMS.map((item) => {
        const active = item.href === "/sell" ? pathname === "/sell" : pathname.startsWith(item.href);
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
