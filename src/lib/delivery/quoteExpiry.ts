/**
 * Pure — no I/O. create_order() is the actual security boundary for
 * quote expiry (it re-checks delivery_quotes.expires_at server-side
 * regardless of anything the client thinks — see
 * 20260930090000_delivery_quoting_booking.sql); this only lets the
 * checkout UI proactively warn the buyer and disable submit before they
 * hit that server rejection, rather than leaving expiry invisible until
 * a confusing late error.
 */
export function isQuoteExpired(expiresAtIso: string, nowMs: number = Date.now()): boolean {
  return new Date(expiresAtIso).getTime() <= nowMs;
}
