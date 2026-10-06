import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { reviewSectionMode } from "@/lib/reviews/reviewSection";

vi.mock("server-only", () => ({}));
// The real form is a client component bound to a server action; its own behaviour is covered by the action tests.
vi.mock("./ReviewForm", () => ({ ReviewForm: ({ orderId }: { orderId: string }) => createElement("form", { "data-review-form": orderId }) }));

const { ReviewSection } = await import("./ReviewSection");

const ORDER_STATUSES = ["pending_payment", "confirmed", "ready_for_collection", "awaiting_delivery", "in_transit", "completed", "cancelled", "disputed", "refunded"];
const REVIEW = { rating: 4, comment: "Great <b>seller</b>", createdAt: "2026-10-01T10:00:00Z" };

const html = (orderStatus: string, review: typeof REVIEW | null) => renderToStaticMarkup(createElement(ReviewSection, { orderId: "order-1", orderStatus, review }));

describe("reviewSectionMode", () => {
  it("the form is offered only for a completed order with no review", () => {
    for (const status of ORDER_STATUSES) {
      expect(reviewSectionMode({ orderStatus: status, hasReview: false })).toBe(status === "completed" ? "form" : "hidden");
    }
  });

  it("once a review exists it is always read-only, whatever the order's status", () => {
    for (const status of ORDER_STATUSES) expect(reviewSectionMode({ orderStatus: status, hasReview: true })).toBe("read_only");
  });
});

describe("ReviewSection rendering", () => {
  it("shows the form only on a completed order without a review", () => {
    expect(html("completed", null)).toContain("data-review-form=\"order-1\"");
    expect(html("completed", null)).toContain("How was your experience?");
  });

  it.each(ORDER_STATUSES.filter((s) => s !== "completed"))("shows nothing for a %s order with no review (including disputed and incomplete orders)", (status) => {
    expect(html(status, null)).toBe("");
  });

  it("hides the form once a review exists and shows the submitted review read-only with a thank-you", () => {
    const out = html("completed", REVIEW);
    expect(out).not.toContain("data-review-form");
    expect(out).toContain("Your review");
    expect(out).toContain("Rated 4 out of 5 stars");
    expect(out).toContain("Thanks for your feedback");
  });

  it("renders the comment as text — HTML in it is escaped, never interpreted", () => {
    const out = html("completed", REVIEW);
    expect(out).toContain("Great &lt;b&gt;seller&lt;/b&gt;");
    expect(out).not.toContain("<b>seller</b>");
  });

  it("a review on an order that later became disputed is still shown read-only", () => {
    expect(html("disputed", REVIEW)).toContain("Your review");
  });

  it("offers no edit, delete, report, reply or moderation controls", () => {
    const out = html("completed", REVIEW);
    expect(out).not.toMatch(/<button|<form|<a /i);
    expect(out).not.toMatch(/edit|delete|report|reply|moderat/i);
  });
});
