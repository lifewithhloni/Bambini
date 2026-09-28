import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
function source(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const actions = source("src", "server", "messaging", "actions.ts");
const getInbox = source("src", "server", "messaging", "getInbox.ts");
const getThread = source("src", "server", "messaging", "getThread.ts");
const listingPage = source("src", "app", "listings", "[id]", "page.tsx");
const personalInbox = source("src", "app", "account", "messages", "page.tsx");
const personalThread = source("src", "app", "account", "messages", "[threadId]", "page.tsx");
const businessInbox = source("src", "app", "account", "business", "[id]", "messages", "page.tsx");
const businessThread = source("src", "app", "account", "business", "[id]", "messages", "[threadId]", "page.tsx");
const clientComponents = ["MessageComposer.tsx", "MessageSellerForm.tsx", "MarkThreadRead.tsx", "ThreadView.tsx", "InboxList.tsx"].map((f) =>
  source("src", "components", "messaging", f),
);
const allMessagingServer = [actions, getInbox, getThread];

describe("messaging server actions — identity is server-derived (F, G, H)", () => {
  it("the only client inputs are a listing/thread id and the message text", () => {
    expect(actions).toMatch(/export async function startConversation\(productId: string, rawBody: string\)/);
    expect(actions).toMatch(/export async function sendMessage\(threadId: string, rawBody: string\)/);
  });

  it("the buyer and sender are always the signed-in user, and the seller/business come from the product row", () => {
    expect(actions).toMatch(/buyer_id: user\.id/);
    expect(actions).toMatch(/sender_id: user\.id/);
    expect(actions).toMatch(/seller_profile_id: product\.seller_profile_id/);
    expect(actions).toMatch(/business_id: product\.business_id/);
  });

  it("anonymous callers are turned away before anything is written", () => {
    expect(actions.match(/getOptionalUser\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(actions).toMatch(/authRequired: true/);
  });

  it("a conversation is created with a duplicate-safe upsert keyed on buyer+listing, never a blind insert", () => {
    expect(actions).toMatch(/onConflict: "buyer_id,product_id"/);
    expect(actions).toMatch(/ignoreDuplicates: true/);
  });

  it("the body is validated by the shared normalizer on both entry points", () => {
    expect(actions.match(/normalizeMessageBody\(rawBody\)/g)?.length).toBe(2);
  });

  it("refuses a listing's own seller (personal, business owner, business member)", () => {
    expect(actions).toMatch(/isOwnListing/);
    expect(actions).toMatch(/owner_profile_id/);
    expect(actions).toMatch(/business_members/);
  });
});

describe("messaging privacy (O, P)", () => {
  it("no server messaging code uses the service-role client for messages/threads, and none logs message content", () => {
    for (const src of allMessagingServer) {
      expect(src).not.toMatch(/createAdminClient|service_role/);
      expect(src).not.toMatch(/console\.(log|error|warn|info)/);
    }
  });

  it("the client components never log message content or keep messages in browser storage", () => {
    for (const src of clientComponents) {
      expect(src).not.toMatch(/localStorage|sessionStorage/);
      expect(src).not.toMatch(/console\.(log|info|warn)/);
    }
  });

  it("message text renders as plain text — no raw HTML injection anywhere in the messaging UI", () => {
    for (const src of clientComponents) {
      expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});

describe("messaging reads are scoped (E, I, J)", () => {
  it("personal and business inbox/thread pages pass distinct scopes to the shared readers", () => {
    expect(personalInbox).toMatch(/kind: "personal"/);
    expect(personalThread).toMatch(/kind: "personal"/);
    expect(businessInbox).toMatch(/kind: "business", businessId: id/);
    expect(businessThread).toMatch(/kind: "business", businessId: id/);
  });

  it("business pages authorize through requireBusinessAccess and personal pages through requireUser", () => {
    expect(businessInbox).toMatch(/requireBusinessAccess\(id/);
    expect(businessThread).toMatch(/requireBusinessAccess\(id/);
    expect(personalInbox).toMatch(/requireUser\(/);
    expect(personalThread).toMatch(/requireUser\(/);
  });

  it("an unreadable or out-of-scope thread is a 404 for everyone alike", () => {
    expect(personalThread).toMatch(/notFound\(\)/);
    expect(businessThread).toMatch(/notFound\(\)/);
  });

  it("a business role is never used as a permission tier", () => {
    for (const src of [...allMessagingServer, businessInbox, businessThread]) {
      expect(src).not.toMatch(/\.role\b|"admin"|"manager"|"staff"/);
    }
  });

  it("a failed read throws to the error boundary — it is never rendered as an empty inbox", () => {
    expect(getInbox).toMatch(/throw new Error/);
  });
});

describe("listing page 'Message seller' (D, E)", () => {
  it("renders the CTA only when the viewer is not the listing's own seller", () => {
    expect(listingPage).toMatch(/!isOwnListing && <MessageSellerForm/);
  });

  it("only looks up an existing conversation for a signed-in, non-owner viewer", () => {
    expect(listingPage).toMatch(/viewer && !isOwnListing \? await getMyThreadForProduct/);
  });
});

describe("no realtime, no notifications, no fake counts (R, S)", () => {
  it("nothing in messaging subscribes to realtime or fakes an unread count client-side", () => {
    for (const src of [...allMessagingServer, ...clientComponents, personalInbox, businessInbox]) {
      expect(src).not.toMatch(/\.channel\(|\.subscribe\(|postgres_changes|setInterval|EventSource|WebSocket/);
      expect(src).not.toMatch(/Notification|pushManager|sendEmail/);
    }
  });
});
