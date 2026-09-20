"use client";

import { useEffect } from "react";

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

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-brand-bg px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-brand-ink">Something went wrong</h1>
      <p className="max-w-sm text-brand-muted">We couldn&apos;t load this page right now. Please try again.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full bg-brand-sage-dark px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-sage"
      >
        Try again
      </button>
    </div>
  );
}
