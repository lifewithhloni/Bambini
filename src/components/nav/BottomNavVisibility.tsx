"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Lets a page-level boundary (currently only the root error.tsx) tell
 * BottomNav to hide itself while it's mounted, restoring automatically
 * on unmount/reset. This exists because Next.js's error.tsx convention
 * inserts its error boundary BETWEEN layout.tsx and {children} — the
 * layout's own markup (SiteHeader, BottomNav) sits structurally above
 * that boundary, so it can never observe a child segment's error state
 * through props/pathname alone. A tiny shared context is the smallest
 * way to bridge that gap without replacing Next's own error.tsx
 * mechanism with a hand-rolled one.
 */
const BottomNavVisibilityContext = createContext<{ setHidden: (hidden: boolean) => void; hidden: boolean }>({
  setHidden: () => {},
  hidden: false,
});

export function BottomNavVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return <BottomNavVisibilityContext.Provider value={{ hidden, setHidden }}>{children}</BottomNavVisibilityContext.Provider>;
}

export function useBottomNavHidden(): boolean {
  return useContext(BottomNavVisibilityContext).hidden;
}

/** Call from any standalone/full-page state (currently just error.tsx) to hide BottomNav for as long as that component stays mounted. */
export function useHideBottomNav(): void {
  const { setHidden } = useContext(BottomNavVisibilityContext);
  useEffect(() => {
    setHidden(true);
    return () => setHidden(false);
  }, [setHidden]);
}
