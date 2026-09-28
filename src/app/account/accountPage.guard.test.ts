import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const accountDir = join(process.cwd(), "src", "app", "account");
// Comments are stripped first: they legitimately name things the code
// must NOT do (e.g. "profiles.account_verification is never read"), and
// this guard is about what the page's code actually does.
const pageSource = readFileSync(join(accountDir, "page.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

// The account experience must stay honest: saved items are real (they read
// product_favourites through the shared server code, and the hub only
// LINKS to them), while messaging and notifications still have no
// application-level backend, so the hub offers no surface for either and
// never fakes one client-side. Messaging (Phase 14B) is likewise real: the
// hub only LINKS to /account/messages and implements none of it itself.
describe("account hub — saved items and messages are linked, never faked; no notifications", () => {
  it("P. links to the real saved-items page and never keeps its own favourites state", () => {
    expect(pageSource).toMatch(/SAVED_HREF/);
    expect(pageSource).not.toMatch(/product_favourites|useState|wishlist/i);
  });

  it("links to the real messages inbox but does not implement messaging itself — no queries, no counts, no client state", () => {
    expect(pageSource).toMatch(/MESSAGES_HREF/);
    expect(pageSource).not.toMatch(/message_threads|from\("messages"\)|unread|getInbox|useState/i);
  });

  it("does not implement notifications or notification preferences", () => {
    expect(pageSource).not.toMatch(/notification/i);
  });

  it("never persists pretend account data in the browser", () => {
    expect(pageSource).not.toMatch(/localStorage|sessionStorage/);
  });

  it("never reads the legacy profiles.account_verification column — verification state comes from getVerificationStatus()", () => {
    expect(pageSource).not.toMatch(/account_verification/);
    expect(pageSource).toMatch(/getVerificationStatus/);
  });
});
