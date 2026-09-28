import { describe, expect, it } from "vitest";
import { BUSINESSES_HREF, BUYER_ORDERS_HREF, LOCATION_HREF, MESSAGES_HREF, SAVED_HREF, SELLER_LINKS, VERIFICATION_HREF, businessHref } from "./accountLinks";

describe("account hub link targets", () => {
  it("every personal-selling entry point leads into the existing /sell area — the hub never duplicates seller functionality", () => {
    for (const href of Object.values(SELLER_LINKS)) {
      expect(href === "/sell" || href.startsWith("/sell/")).toBe(true);
    }
    expect(SELLER_LINKS.sell).toBe("/sell");
  });

  it("the buyer orders entry point is the existing /account/orders", () => {
    expect(BUYER_ORDERS_HREF).toBe("/account/orders");
  });

  it("each business links to its own /account/business/[id] — never a shared or merged page", () => {
    expect(businessHref("biz-1")).toBe("/account/business/biz-1");
    expect(businessHref("biz-2")).toBe("/account/business/biz-2");
    expect(businessHref("biz-1")).not.toBe(businessHref("biz-2"));
    expect(BUSINESSES_HREF).toBe("/account/business");
  });

  it("verification and location point at the existing account pages", () => {
    expect(VERIFICATION_HREF).toBe("/account/verification");
    expect(LOCATION_HREF).toBe("/account/location");
  });

  it("Q. saved items point to /account/saved — a real feature backed by product_favourites", () => {
    expect(SAVED_HREF).toBe("/account/saved");
  });

  it("messages point to the personal inbox /account/messages — a real feature backed by message_threads", () => {
    expect(MESSAGES_HREF).toBe("/account/messages");
  });

  it("no notification destination exists here — there is no application-level backend for it", () => {
    const all = [...Object.values(SELLER_LINKS), BUYER_ORDERS_HREF, SAVED_HREF, MESSAGES_HREF, VERIFICATION_HREF, LOCATION_HREF, BUSINESSES_HREF, businessHref("x")].join(" ");
    expect(all).not.toMatch(/notification/i);
  });
});
