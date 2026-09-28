import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const srcDir = join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(join(srcDir, rel), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("favourites — one shared mechanism", () => {
  it("O. ProductCard, the listing detail page, and the saved-items page all render the same FavoriteButton", () => {
    expect(read("components/listings/ProductCard.tsx")).toMatch(/import \{ FavoriteButton \} from "\.\/FavoriteButton"/);
    expect(read("app/listings/[id]/page.tsx")).toMatch(/FavoriteButton/);
    expect(read("app/account/saved/page.tsx")).toMatch(/FavoriteButton/);
  });

  it("O. save/unsave logic exists only in the shared server actions — the button, card, and pages never touch product_favourites themselves", () => {
    for (const rel of ["components/listings/ProductCard.tsx", "components/listings/FavoriteButton.tsx", "app/listings/[id]/page.tsx", "app/account/saved/page.tsx"]) {
      expect(stripComments(read(rel)), rel).not.toMatch(/product_favourites/);
    }
    expect(read("components/listings/FavoriteButton.tsx")).toMatch(/saveListing/);
    expect(read("components/listings/FavoriteButton.tsx")).toMatch(/unsaveListing/);
  });

  it("nothing stores favourites in the browser — this is persistent account data, not localStorage", () => {
    for (const rel of ["components/listings/FavoriteButton.tsx", "app/account/saved/page.tsx", "server/favourites/actions.ts"]) {
      expect(stripComments(read(rel)), rel).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });

  it("the FavoriteButton exposes aria-pressed and an accessible label for saved state, not colour alone", () => {
    const source = read("components/listings/FavoriteButton.tsx");
    expect(source).toMatch(/aria-pressed/);
    expect(source).toMatch(/aria-label=\{label\}/);
    expect(source).toMatch(/Remove \$\{title\} from saved items/);
    expect(source).toMatch(/Save \$\{title\}/);
  });
});

describe("favourites — private data only", () => {
  it("R. product_favourites is referenced only by the three favourites server modules, and none of them count or aggregate it", () => {
    const allowed = new Set(["server/favourites/actions.ts", "server/favourites/getFavouriteState.ts", "server/favourites/getSavedItems.ts", "types/database.types.ts"]);
    for (const file of walk(srcDir)) {
      const rel = file.slice(srcDir.length + 1).replace(/\\/g, "/");
      const code = stripComments(readFileSync(file, "utf8"));
      if (/product_favourites/.test(code)) {
        expect(allowed.has(rel), `${rel} must not read product_favourites directly`).toBe(true);
        if (rel.startsWith("server/favourites/")) expect(code, rel).not.toMatch(/count\s*:\s*["']exact|\.count\b|head\s*:\s*true/);
      }
    }
  });

  it("S. no favourite notification exists anywhere — saving never triggers a seller-facing event", () => {
    for (const rel of ["server/favourites/actions.ts", "server/favourites/getSavedItems.ts", "server/favourites/getFavouriteState.ts"]) {
      expect(stripComments(read(rel)), rel).not.toMatch(/notif|transaction_events|sendEmail|message_threads/i);
    }
  });

  it("R. seller-facing pages never read favourites — sellers and businesses can't see who saved their listings", () => {
    for (const file of walk(join(srcDir, "app", "sell")).concat(walk(join(srcDir, "app", "account", "business")))) {
      expect(stripComments(readFileSync(file, "utf8")), file).not.toMatch(/favourite|favorite/i);
    }
  });
});
