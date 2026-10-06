import { describe, expect, it } from "vitest";
import { humanizeReviewError, GENERIC_REVIEW_ERROR } from "./errors";
import { parseReviewForm, parseReviewInput, REVIEW_COMMENT_MAX } from "./validation";

const ORDER = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseReviewInput — rating", () => {
  it.each([1, 2, 3, 4, 5])("accepts %i (number or string)", (n) => {
    expect(parseReviewInput({ orderId: ORDER, rating: n, comment: null })).toEqual({ ok: true, data: { orderId: ORDER, rating: n, comment: null } });
    expect(parseReviewInput({ orderId: ORDER, rating: String(n), comment: null }).ok).toBe(true);
  });

  it.each([0, 6, -1, 4.5, "4.5", "0", "6", "", " ", "abc", "3 ", "1e0", null, undefined, NaN, {}, [], true])("rejects %j", (rating) => {
    const r = parseReviewInput({ orderId: ORDER, rating, comment: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Please choose a rating from 1 to 5 stars.");
  });
});

describe("parseReviewInput — comment", () => {
  const ok = (comment: unknown) => parseReviewInput({ orderId: ORDER, rating: 5, comment });

  it("a missing or blank comment box means 'no comment' (null)", () => {
    for (const c of [undefined, null, ""]) {
      const r = ok(c);
      expect(r.ok && r.data.comment).toBeNull();
    }
  });

  it("trims and keeps the trimmed value", () => {
    const r = ok("  \n lovely seller \t");
    expect(r.ok && r.data.comment).toBe("lovely seller");
  });

  it("rejects a whitespace-only comment instead of silently dropping it", () => {
    for (const c of [" ", "\n\n", " \t "]) expect(ok(c).ok).toBe(false);
  });

  it("accepts exactly 1000 characters and rejects 1001 — never truncating", () => {
    expect(ok("a".repeat(REVIEW_COMMENT_MAX)).ok).toBe(true);
    const over = ok("a".repeat(REVIEW_COMMENT_MAX + 1));
    expect(over.ok).toBe(false);
  });

  it("counts characters the way Postgres does: 1000 emoji pass, 1001 fail (not UTF-16 units)", () => {
    expect(ok("😀".repeat(1000)).ok).toBe(true);
    expect(ok("😀".repeat(1001)).ok).toBe(false);
  });

  it("rejects a non-string comment", () => {
    for (const c of [123, {}, ["x"], true]) expect(ok(c).ok).toBe(false);
  });

  it("keeps script/HTML text as plain text, untouched", () => {
    const s = '<script>alert("x")</script>';
    const r = ok(s);
    expect(r.ok && r.data.comment).toBe(s);
  });
});

describe("parseReviewInput — order id", () => {
  it.each([undefined, null, "", "not-a-uuid", "6f9619ff-8b86-d011-b42d-00c04fc964f", `${ORDER}x`, 5, {}])("rejects %j", (orderId) => {
    expect(parseReviewInput({ orderId, rating: 5, comment: null }).ok).toBe(false);
  });
});

describe("parseReviewForm — only order id, rating and comment are ever read", () => {
  it("ignores every identity/reserved field a forged form might carry", () => {
    const r = parseReviewForm(
      ORDER,
      form({
        rating: "4",
        comment: "ok",
        reviewer_id: "attacker",
        seller_profile_id: "victim",
        business_id: "victim-biz",
        seller_type: "business",
        product_id: "other-product",
        seller_response: "fake reply",
        created_at: "2001-01-01",
        hidden_at: "2001-01-01",
        orderId: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(r).toEqual({ ok: true, data: { orderId: ORDER, rating: 4, comment: "ok" } });
    expect(Object.keys((r as { data: object }).data).sort()).toEqual(["comment", "orderId", "rating"]);
  });

  it("the order comes from the bound argument, not a form field", () => {
    const r = parseReviewForm(ORDER, form({ rating: "5", orderId: "11111111-1111-1111-1111-111111111111" }));
    expect(r.ok && r.data.orderId).toBe(ORDER);
  });
});

describe("humanizeReviewError", () => {
  it.each([
    ["Authentication required", "Please sign in to leave a review."],
    ["Order not found", "We couldn't find that order."],
    ["Order is not completed", "You can review an order once it's completed."],
    ["Order has already been reviewed", "You've already reviewed this order."],
    ["Invalid rating", "Please choose a rating from 1 to 5 stars."],
    ["Invalid comment", "Your comment must be between 1 and 1000 characters."],
  ])("%s -> safe message", (raw, friendly) => {
    expect(humanizeReviewError(raw)).toEqual({ message: friendly, known: true });
  });

  it("anything unrecognized (SQL errors, internals) becomes the generic message and never leaks through", () => {
    for (const raw of [
      'duplicate key value violates unique constraint "reviews_order_id_key"',
      "permission denied for table profiles",
      'new row for relation "reviews" violates check constraint "reviews_comment_valid"',
      "PL/pgSQL function create_review(uuid,integer,text) line 12 at RAISE",
      undefined,
      null,
      "",
    ]) {
      const r = humanizeReviewError(raw as string);
      expect(r).toEqual({ message: GENERIC_REVIEW_ERROR, known: false });
      expect(r.message).not.toMatch(/reviews|pgsql|constraint|permission|profiles/i);
    }
  });
});
