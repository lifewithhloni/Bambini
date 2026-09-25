"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, User } from "@/components/ui/icons";
import { useBottomNavHidden } from "./BottomNavVisibility";

/**
 * Mobile bottom navigation — fixed, safe-area-aware, hidden at the
 * `sm` breakpoint and up (desktop uses SiteHeader's own nav instead).
 * Deliberately only 4 items, not the 5 a typical "Home / Explore / Sell
 * / Inbox / Profile" reference layout might suggest: there is no
 * messaging/inbox ROUTE anywhere in this app yet
 * (message_threads exists in the database since the foundation phase,
 * but no /inbox page was ever built), and this phase's own brief is
 * explicit that navigation must never link to a route that doesn't
 * exist. Add a 5th item here the day an inbox page ships.
 */
const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Explore", icon: Search },
  { href: "/sell", label: "Sell", icon: PlusCircle },
  { href: "/account", label: "Profile", icon: User },
] as const;

// Routes where the main customer-app tab bar is the wrong navigation
// model — an admin console, an auth flow the user hasn't completed yet,
// or an onboarding/verification step that should feel like a focused
// task, not a page inside the browsable marketplace. Matched by exact
// path or path prefix, same idiom as the active-tab check below.
const HIDDEN_ON = ["/admin", "/login", "/signup", "/account/verification", "/account/business/new"];

function isHiddenRoute(pathname: string): boolean {
  return HIDDEN_ON.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function BottomNav() {
  const pathname = usePathname();
  const hiddenByErrorBoundary = useBottomNavHidden();

  if (isHiddenRoute(pathname) || hiddenByErrorBoundary) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-brand-border bg-brand-surface/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-caption font-medium"
          >
            <Icon className={`h-6 w-6 ${active ? "text-bambini-forest" : "text-brand-muted"}`} aria-hidden="true" strokeWidth={active ? 2.25 : 2} />
            <span className={active ? "text-bambini-forest" : "text-brand-muted"}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
