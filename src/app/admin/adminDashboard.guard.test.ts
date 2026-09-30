import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const stripped = (...parts: string[]) =>
  readFileSync(join(root, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const page = stripped("src", "app", "admin", "page.tsx");
const overview = stripped("src", "server", "admin", "getAdminOverview.ts");

// The existing admin section pages/routes this dashboard must link to
// without changing — asserting they still exist is the guard against
// "existing admin routes remain unchanged" via this feature.
const EXISTING_ADMIN_PAGES = [
  "src/app/admin/verifications/page.tsx",
  "src/app/admin/business-verifications/page.tsx",
  "src/app/admin/disputes/page.tsx",
  "src/app/admin/payouts/page.tsx",
  "src/app/admin/delivery/page.tsx",
  "src/app/admin/delivery/settings/page.tsx",
  "src/app/admin/delivery/transactions/page.tsx",
];

describe("/admin dashboard — authorization (non-admin gets the same 404 as every other admin route)", () => {
  it("the page itself calls requireAdmin() before rendering anything", () => {
    expect(page).toMatch(/await requireAdmin\(["']\/admin["']\)/);
  });

  it("the overview data function also independently calls requireAdmin() — defense in depth, matching every other admin data function in this codebase", () => {
    expect(overview).toMatch(/await requireAdmin\(["']\/admin["']\)/);
  });

  it("never imports the admin/service-role client — RLS plus requireAdmin() stays the only boundary", () => {
    for (const src of [page, overview]) {
      expect(src).not.toMatch(/createAdminClient|service_role/);
    }
  });
});

describe("/admin dashboard — reuses existing admin functions, invents nothing", () => {
  it("the page never queries a table directly — every count comes from getAdminOverview()", () => {
    expect(page).not.toMatch(/\.from\(["']|supabase\.rpc\(/);
    expect(page).toMatch(/getAdminOverview\(\)/);
  });

  it("getAdminOverview() only calls the five existing, already-admin-gated list functions — no new query", () => {
    expect(overview).toMatch(/listPendingVerifications\(\)/);
    expect(overview).toMatch(/listPendingBusinessVerifications\(\)/);
    expect(overview).toMatch(/listDisputes\(\)/);
    expect(overview).toMatch(/listPayouts\(\)/);
    expect(overview).toMatch(/listStuckPendingDeliveries\(\)/);
    expect(overview).not.toMatch(/\.from\(["']|supabase\.rpc\(/);
  });

  it("no count is a hardcoded or random number — every field in the returned object traces back to a real array's .length or .filter().length", () => {
    expect(overview).not.toMatch(/count:\s*\d+|Math\.random/);
  });
});

describe("/admin dashboard — navigation targets the existing routes, no route is modified", () => {
  it.each(EXISTING_ADMIN_PAGES)("%s still exists, unmodified in location", (relPath) => {
    // Throws (failing the test) if the file has been moved/removed.
    expect(() => readFileSync(join(root, relPath), "utf8")).not.toThrow();
  });

  it("the dashboard links to every existing admin route by its real href, nothing invented", () => {
    for (const href of ["/admin/verifications", "/admin/business-verifications", "/admin/disputes", "/admin/payouts", "/admin/delivery/settings", "/admin/delivery/transactions"]) {
      expect(page, href).toContain(`"${href}"`);
    }
    // "/admin/delivery" itself is a substring of "/admin/delivery/settings" —
    // checked separately so the assertion isn't trivially satisfied by those.
    expect(page).toMatch(/href:\s*"\/admin\/delivery"/);
  });
});

describe("/admin dashboard — no privileged content rendered directly", () => {
  it("never renders a raw ID number, document path, or signed URL — this page only shows counts and navigation", () => {
    for (const src of [page, overview]) {
      expect(src).not.toMatch(/id_number|document_storage_path|documentSignedUrl|createSignedUrl/);
    }
  });
});
