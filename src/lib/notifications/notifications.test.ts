import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, decodeCursor, encodeCursor, isNotificationType, notificationHref } from "./notifications";

const ORDER = "11111111-1111-4111-8111-111111111111";
const BIZ = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

describe("notificationHref — G. deep links are derived, validated and land in the right existing experience", () => {
  it("buyer order-related notifications open the buyer's order", () => {
    for (const type of ["order_updated", "payment_updated", "delivery_updated", "dispute_updated"]) {
      expect(notificationHref(type, { order_id: ORDER, audience: "buyer" })).toBe(`/account/orders/${ORDER}`);
    }
  });

  it("a personal seller's order notifications open /sell/orders, a business member's open that business's order", () => {
    expect(notificationHref("payment_updated", { order_id: ORDER, audience: "seller" })).toBe(`/sell/orders/${ORDER}`);
    expect(notificationHref("payment_updated", { order_id: ORDER, audience: "seller", business_id: BIZ })).toBe(`/account/business/${BIZ}/orders/${ORDER}`);
  });

  it("message notifications open the personal thread, or the business thread for a business recipient", () => {
    expect(notificationHref("message_received", { thread_id: THREAD })).toBe(`/account/messages/${THREAD}`);
    expect(notificationHref("message_received", { thread_id: THREAD, business_id: BIZ })).toBe(`/account/business/${BIZ}/messages/${THREAD}`);
  });

  it("verification notifications open identity verification or the business", () => {
    expect(notificationHref("verification_updated", { kind: "identity", status: "verified" })).toBe("/account/verification");
    expect(notificationHref("verification_updated", { kind: "business", business_id: BIZ })).toBe(`/account/business/${BIZ}`);
  });

  it("payout notifications open personal or business payouts", () => {
    expect(notificationHref("payout_updated", {})).toBe("/sell/payouts");
    expect(notificationHref("payout_updated", { business_id: BIZ })).toBe(`/account/business/${BIZ}/payouts`);
  });

  it("returns no link — never a wrong one — for missing, malformed or unknown references", () => {
    expect(notificationHref("order_updated", {})).toBeNull();
    expect(notificationHref("order_updated", { order_id: ORDER })).toBeNull();
    expect(notificationHref("order_updated", { order_id: "../../admin", audience: "buyer" })).toBeNull();
    expect(notificationHref("message_received", { thread_id: "1; drop table" })).toBeNull();
    expect(notificationHref("verification_updated", { kind: "business" })).toBeNull();
    expect(notificationHref("something_else", { order_id: ORDER, audience: "buyer" })).toBeNull();
  });

  it("an id can never smuggle a path segment or query into the link", () => {
    const href = notificationHref("message_received", { thread_id: `${THREAD}/../x?y=1`, business_id: BIZ });
    expect(href).toBeNull();
  });

  it("rejects data carrying a field that type isn't allowed to have, even if it's otherwise well-formed", () => {
    // A order-typed notification with a thread_id would mean a producer bug
    // wrote the wrong shape — fail closed rather than silently ignoring it.
    expect(notificationHref("order_updated", { order_id: ORDER, audience: "buyer", thread_id: THREAD })).toBeNull();
    expect(notificationHref("message_received", { thread_id: THREAD, order_id: ORDER })).toBeNull();
    expect(notificationHref("payout_updated", { order_id: ORDER })).toBeNull();
  });

  it("a well-formed but unrelated reference id still only ever produces a link into the viewer's OWN scoped experience, never a path that names another user", () => {
    // notificationHref has no relationship to the current viewer at all —
    // by construction every path it can produce is one of the fixed,
    // parameterised route templates below, never one that embeds anything
    // other than a reference id. The actual "is this id really mine"
    // check happens at the destination route (getOrder()/getThread()/
    // requireBusinessAccess(), independently re-verified — see notes on
    // notificationHref itself), which this function can't and doesn't
    // attempt to replace.
    const anyWellFormedId = "99999999-9999-4999-8999-999999999999";
    expect(notificationHref("order_updated", { order_id: anyWellFormedId, audience: "buyer" })).toBe(`/account/orders/${anyWellFormedId}`);
    expect(notificationHref("message_received", { thread_id: anyWellFormedId })).toBe(`/account/messages/${anyWellFormedId}`);
  });
});

describe("notification types", () => {
  it("is a closed list matching the database check constraint", () => {
    expect([...NOTIFICATION_TYPES].sort()).toEqual(
      ["delivery_updated", "dispute_updated", "message_received", "order_updated", "payment_updated", "payout_updated", "verification_updated"].sort(),
    );
    expect(isNotificationType("order_updated")).toBe(true);
    expect(isNotificationType("free_form")).toBe(false);
  });
});

describe("pagination cursor", () => {
  const TS = "2026-09-28T12:05:31.460123+00:00";

  it("round-trips a (created_at, id) cursor", () => {
    expect(decodeCursor(encodeCursor(TS, ORDER))).toEqual({ createdAt: TS, id: ORDER });
  });

  it("rejects anything that isn't strictly a timestamp and a uuid — it is placed into a query filter", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(`${TS}|not-a-uuid`)).toBeNull();
    expect(decodeCursor(`2026-01-01|${ORDER}`)).toBeNull();
    expect(decodeCursor(`2026-09-28T12:05:31Z",id.eq.x|${ORDER}`)).toBeNull();
    expect(decodeCursor(`${TS}|${ORDER}|extra`)).toBeNull();
  });
});
