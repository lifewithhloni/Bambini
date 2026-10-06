import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-level guards for the Reviews MVP (Phase 15B.1): the review write
 * path is create_review() ONLY; the app never writes the table, never
 * reads identity fields from a form, and the buyer order page is the only
 * place a review can be left.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const srcFiles = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith("database.types.ts"));

describe("the app has exactly one way to write a review", () => {
  it("no application code inserts, updates, upserts or deletes on the reviews table", () => {
    const offenders = srcFiles
      .filter((f) => /from\(\s*["']reviews["']\s*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("create_review is called from exactly one place: the review server action", () => {
    const callers = srcFiles.filter((f) => /rpc\(\s*["']create_review["']/.test(stripComments(fs.readFileSync(f, "utf8")))).map(rel);
    expect(callers).toEqual(["src/server/reviews/actions.ts"]);
  });

  it("only getOrderReview reads the reviews base table, and only the three display columns", () => {
    const readers = srcFiles.filter((f) => /from\(\s*["']reviews["']\s*\)/.test(stripComments(fs.readFileSync(f, "utf8")))).map(rel);
    expect(readers).toEqual(["src/server/reviews/getOrderReview.ts"]);
    expect(stripComments(read("src/server/reviews/getOrderReview.ts"))).toMatch(/\.select\("rating, comment, created_at"\)/);
  });
});

describe("the action and form take only order, rating and comment", () => {
  const action = stripComments(read("src/server/reviews/actions.ts"));
  const validation = stripComments(read("src/server/reviews/validation.ts"));
  const form = stripComments(read("src/components/reviews/ReviewForm.tsx"));

  it("form data is read only for rating and comment (the order is a bound argument)", () => {
    const keys = [...validation.matchAll(/formData\.get\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(["comment", "rating"]);
    expect(action).not.toMatch(/formData\.get\(/);
  });

  it("nothing in the action or validation names a reviewer, seller, business, product, reply, timestamp or hidden field", () => {
    for (const code of [action, validation]) {
      expect(code).not.toMatch(/reviewer_id|seller_profile_id|business_id|seller_type|product_id|seller_response|created_at|hidden_at/);
    }
  });

  it("the form has exactly two named inputs (rating, comment) and no hidden fields", () => {
    const names = [...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["comment", "rating"]);
    expect(form).not.toMatch(/type="hidden"/);
  });

  it("nothing in the reviews server code logs, apart from the single static unexpected-failure line", () => {
    for (const f of ["actions.ts", "errors.ts", "validation.ts", "getOrderReview.ts"]) {
      const code = stripComments(read(`src/server/reviews/${f}`));
      const logs = [...code.matchAll(/console\.\w+\(([^)]*)\)/g)].map((m) => m[0]);
      if (f === "actions.ts") expect(logs).toEqual(['console.error("Review submission failed unexpectedly.")']);
      else expect(logs).toEqual([]);
    }
  });

  it("comments are never rendered as raw HTML", () => {
    for (const f of ["src/components/reviews/ReviewForm.tsx", "src/components/reviews/ReviewSection.tsx"]) {
      expect(read(f)).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});

describe("where reviews appear in the UI", () => {
  it("the buyer order page renders the review section after the dispute section, with the buyer's own review", () => {
    const page = read("src/app/account/orders/[id]/page.tsx");
    expect(page).toMatch(/getOrderReview\(order\.id\)/);
    expect(page).toMatch(/<ReviewSection orderId=\{order\.id\} orderStatus=\{order\.status\} review=\{review\} \/>/);
    expect(page.indexOf("<DisputeSection")).toBeLessThan(page.indexOf("<ReviewSection"));
  });

  it("the page is still buyer-gated: a non-buyer gets not-found before any review UI", () => {
    const page = read("src/app/account/orders/[id]/page.tsx");
    expect(page.indexOf("order.buyer_id !== user.id")).toBeGreaterThan(-1);
    expect(page.indexOf("order.buyer_id !== user.id")).toBeLessThan(page.indexOf("<ReviewSection"));
  });

  it("no seller-side or other page offers a review form, and no seller reply/edit/delete/report/moderation UI exists", () => {
    const users = srcFiles.filter((f) => /components\/reviews\/Review(Section|Form)"|\.\/ReviewForm"|\bsubmitReview\b/.test(stripComments(fs.readFileSync(f, "utf8")))).map(rel).sort();
    expect(users).toEqual([
      "src/app/account/orders/[id]/page.tsx",
      "src/components/reviews/ReviewForm.tsx",
      "src/components/reviews/ReviewSection.tsx",
      "src/server/reviews/actions.ts",
    ]);
    expect(fs.existsSync(path.join(ROOT, "src/app/admin/reviews"))).toBe(false);
  });

  it("no review notification type was added", () => {
    const notifications = read("src/lib/notifications/notifications.ts");
    expect(notifications).not.toMatch(/review/i);
  });
});
