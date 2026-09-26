/**
 * Bambini's cart is deliberately NOT a database table (see this phase's
 * own report for the audit that led here): create_order() takes exactly
 * one product id and atomically flips it 'published' -> 'sold' the
 * moment an order is created — there is no quantity concept anywhere in
 * this schema, a listing is a unique, one-of-a-kind item. A cart is
 * therefore nothing more than "which listing ids is this browser
 * interested in" — buyer INTENT, never authoritative financial or
 * availability data. Storing that in localStorage means:
 *   - it works identically for a signed-out visitor and a signed-in
 *     buyer, with zero merge logic — logging in doesn't touch
 *     localStorage, so a guest's cart is simply still there afterwards;
 *   - it never needs RLS, since it never leaves the browser;
 *   - it can never be mistaken for something authoritative, since the
 *     server never reads it — every price/availability/eligibility
 *     shown against these ids is re-fetched fresh (see
 *     src/server/cart/getCartListings.ts) every time the cart is
 *     displayed.
 *
 * The array-mutation logic below is written as pure functions
 * operating on a plain string array, deliberately separate from the
 * localStorage I/O — this project's vitest setup has no jsdom/browser
 * environment (see Phase 10's own report), so anything touching `window`
 * directly can't be unit tested; keeping the actual "what does adding/
 * removing an id do" logic pure and DOM-free is what makes it testable
 * at all within the existing test architecture.
 */

export type CartIds = string[];

export const CART_STORAGE_KEY = "bambini.cart.v1";
export const CART_CHANGED_EVENT = "bambini:cart-changed";
const MAX_CART_ITEMS = 100;

/** A listing is a unique item, never a quantity — adding an id already present is a no-op, not an increment. */
export function addIdPure(ids: CartIds, id: string): CartIds {
  if (ids.includes(id)) return ids;
  return [...ids, id].slice(0, MAX_CART_ITEMS);
}

export function removeIdPure(ids: CartIds, id: string): CartIds {
  return ids.filter((existing) => existing !== id);
}

export function parseStoredIds(raw: string | null): CartIds {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_CART_ITEMS);
  } catch {
    return [];
  }
}

function readIds(): CartIds {
  if (typeof window === "undefined") return [];
  try {
    return parseStoredIds(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    // Private browsing / storage disabled / blocked — the cart simply
    // won't persist for this visitor, never a thrown error the page has
    // to handle.
    return [];
  }
}

function writeIds(ids: CartIds): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(ids));
    // localStorage's own native "storage" event only fires in OTHER
    // tabs, never the tab that made the change — this custom event is
    // what lets e.g. the header cart count and the cart page itself
    // (or two instances of an Add to cart button) stay in sync within
    // the same tab.
    window.dispatchEvent(new Event(CART_CHANGED_EVENT));
  } catch {
    // Ignore — see readIds().
  }
}

export function getCartIds(): CartIds {
  return readIds();
}

export function addToCart(id: string): CartIds {
  const next = addIdPure(readIds(), id);
  writeIds(next);
  return next;
}

export function removeFromCart(id: string): CartIds {
  const next = removeIdPure(readIds(), id);
  writeIds(next);
  return next;
}

export function isInCart(id: string): boolean {
  return readIds().includes(id);
}
