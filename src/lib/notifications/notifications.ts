export const NOTIFICATION_TYPES = [
  "order_updated",
  "payment_updated",
  "delivery_updated",
  "dispute_updated",
  "message_received",
  "verification_updated",
  "payout_updated",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATIONS_PAGE_SIZE = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function id(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

// The exact fields each type is allowed to carry — nothing else. This is
// deliberately stricter than reading just the fields each branch below
// happens to use: an unexpected extra key (e.g. a future producer bug
// that copies the wrong field onto the wrong type) fails closed here
// instead of silently being ignored.
const EXPECTED_DATA_KEYS: Record<NotificationType, ReadonlySet<string>> = {
  order_updated: new Set(["order_id", "audience", "business_id"]),
  payment_updated: new Set(["order_id", "audience", "business_id"]),
  delivery_updated: new Set(["order_id", "audience", "business_id"]),
  dispute_updated: new Set(["order_id", "audience", "business_id"]),
  message_received: new Set(["thread_id", "business_id"]),
  verification_updated: new Set(["kind", "status", "business_id"]),
  payout_updated: new Set(["business_id"]),
};

function hasOnlyExpectedKeys(type: NotificationType, data: Record<string, unknown>): boolean {
  const allowed = EXPECTED_DATA_KEYS[type];
  return Object.keys(data).every((key) => allowed.has(key));
}

/**
 * The deep link for a notification, derived from its type and the opaque
 * reference ids the database stored — never a stored URL, so a link can't be
 * planted and always follows the current routes. Every id is re-validated as
 * a UUID before it is put in a path, and `data` must contain only the exact
 * fields that type is allowed to carry (see EXPECTED_DATA_KEYS). Returns
 * null when the shape doesn't describe a known destination (the
 * notification then renders without a link rather than linking somewhere
 * wrong).
 *
 * This function is NOT an authorization check, and can't be one: `data`
 * only ever holds opaque reference ids, never a relationship to the current
 * viewer. Authorization is the destination route's job — every route this
 * can link to independently re-derives ownership from the signed-in user
 * before rendering anything (buyer/seller order pages compare buyer_id/
 * viewerIsOrderSeller(), business routes call requireBusinessAccess() and
 * re-check the entity's own business_id, thread pages read the thread
 * through getThread()'s participant-scoped query) and shows a plain
 * not-found for an id that exists but isn't the viewer's — the same
 * response as an id that doesn't exist at all. So even a malformed or
 * stale reference id here can, at worst, link to a 404 or to the viewer's
 * OWN unrelated data; it can never expose another user's data.
 *
 * Personal sellers, buyers and business members each land in their own
 * existing experience: buyer orders in /account/orders, personal seller
 * orders in /sell/orders, and business orders/messages/payouts under that
 * one business.
 */
export function notificationHref(type: string, data: Record<string, unknown>): string | null {
  if (!isNotificationType(type) || !hasOnlyExpectedKeys(type, data)) return null;
  const orderId = id(data.order_id);
  const businessId = id(data.business_id);
  const threadId = id(data.thread_id);

  switch (type) {
    case "order_updated":
    case "payment_updated":
    case "delivery_updated":
    case "dispute_updated": {
      if (!orderId) return null;
      if (data.audience === "buyer") return `/account/orders/${orderId}`;
      if (data.audience === "seller") return businessId ? `/account/business/${businessId}/orders/${orderId}` : `/sell/orders/${orderId}`;
      return null;
    }
    case "message_received": {
      if (!threadId) return null;
      return businessId ? `/account/business/${businessId}/messages/${threadId}` : `/account/messages/${threadId}`;
    }
    case "verification_updated": {
      if (data.kind === "identity") return "/account/verification";
      if (data.kind === "business" && businessId) return `/account/business/${businessId}`;
      return null;
    }
    case "payout_updated":
      return businessId ? `/account/business/${businessId}/payouts` : "/sell/payouts";
    default:
      return null;
  }
}

/** Cursor for "older notifications": the (created_at, id) of the last row of the current page. */
export function encodeCursor(createdAt: string, notificationId: string): string {
  return `${createdAt}|${notificationId}`;
}

export function decodeCursor(raw: string | undefined): { createdAt: string; id: string } | null {
  if (!raw) return null;
  const [createdAt, notificationId, ...rest] = raw.split("|");
  if (rest.length > 0 || !createdAt || !id(notificationId)) return null;
  // Strict shape (no lenient Date parsing): this string is placed into a PostgREST filter.
  if (!TIMESTAMP_PATTERN.test(createdAt)) return null;
  return { createdAt, id: notificationId };
}
