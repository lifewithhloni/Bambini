"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useHideBottomNav } from "@/components/nav/BottomNavVisibility";

/**
 * Next.js's error-boundary convention: catches an uncaught error thrown
 * anywhere under the root layout (e.g. getCategoryTree()/searchListings()
 * failing because Supabase is unreachable) and renders this instead of
 * the framework's raw error overlay. Deliberately NOT swallowed at the
 * data-fetching layer — unlike src/server/auth/requireUser.ts's
 * getOptionalUser() (which degrades a site-wide header to "logged out"
 * because that's still a meaningful page), a marketplace page with no
 * catalogue data to show has nothing meaningful to render either way, so
 * a clear "something went wrong" is the right outcome, not a silent
 * empty page pretending everything's fine.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // A standalone error state — BottomNav sits structurally above this
  // boundary in layout.tsx (see BottomNavVisibility.tsx), so it can't
  // otherwise know this happened; unhides itself automatically the
  // moment this component unmounts (a successful reset(), or
  // navigating away).
  useHideBottomNav();

  return (
    <div className="flex flex-1 items-center justify-center bg-brand-bg px-6 py-24">
      <ErrorState description="We couldn't load this page right now. Please try again." onRetry={() => reset()} />
    </div>
  );
}
