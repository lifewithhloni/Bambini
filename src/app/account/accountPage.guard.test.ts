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

// The account experience must stay honest: the schema has
// product_favourites and message_threads tables, but no application code
// reads or writes either, so the hub offers no saved-items or messaging
// surface and never fakes one client-side.
describe("account hub — no fake favorites, messaging, or notifications", () => {
  it("does not implement saved items or favourites", () => {
    expect(pageSource).not.toMatch(/favou?rite|wishlist|saved items/i);
  });

  it("does not implement messaging", () => {
    expect(pageSource).not.toMatch(/inbox|conversation|message_threads|\/messages/i);
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
