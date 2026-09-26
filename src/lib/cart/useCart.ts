"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getCartIds, addToCart, removeFromCart, CART_CHANGED_EVENT, type CartIds } from "./cartStorage";

// A tiny content-based cache so repeated reads return the SAME array
// reference whenever the underlying stored ids haven't actually
// changed — useSyncExternalStore compares snapshots with Object.is, and
// getCartIds() itself returns a freshly-parsed array on every call, so
// without this a subscriber would re-render on every single read even
// when nothing changed.
let cachedIds: CartIds = [];
let cachedFingerprint = "";

function readSnapshot(): CartIds {
  const fresh = getCartIds();
  const fingerprint = fresh.join("\u0000"); // ids are UUIDs, never contain this character
  if (fingerprint !== cachedFingerprint) {
    cachedFingerprint = fingerprint;
    cachedIds = fresh;
  }
  return cachedIds;
}

function getServerSnapshot(): CartIds {
  return []; // no access to the browser's localStorage during SSR — matches "nothing in the cart yet" until the client corrects it
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CART_CHANGED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * The single hook every cart-aware client component uses (the header
 * count, the Add/Remove buttons, the cart page itself) so they all read
 * the same localStorage-backed state and stay in sync with each other
 * within one tab (CART_CHANGED_EVENT) and across tabs (the native
 * "storage" event). Built on useSyncExternalStore rather than a
 * useEffect+useState hydration dance — the correct, React-recommended
 * way to subscribe to state that lives outside React, and it resolves
 * the server/client snapshot mismatch (SSR has no localStorage) without
 * a manual "have we mounted yet" flag.
 */
export function useCart() {
  const ids = useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);

  const add = useCallback((id: string) => {
    addToCart(id);
  }, []);
  const remove = useCallback((id: string) => {
    removeFromCart(id);
  }, []);
  const has = useCallback((id: string) => ids.includes(id), [ids]);

  return { ids, count: ids.length, add, remove, has };
}
