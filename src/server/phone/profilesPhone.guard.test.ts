import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-level guard for the Phase 15A.1 decision: profiles.phone is a
 * retained, NON-AUTHORITATIVE legacy column. Nothing in application code
 * may read it, write it, or treat it as proof of verification; the only
 * phone the app trusts is Supabase Auth's (user.phone + phone_confirmed_at).
 * (The database side is proved in tests/db/phone-verification.test.ts.)
 */
const SRC = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const files = walk(SRC)
  // The generated-by-hand DB types legitimately list every column.
  .filter((f) => !f.endsWith(path.join("types", "database.types.ts")))
  .map((f) => ({ file: path.relative(SRC, f).split(path.sep).join("/"), code: stripComments(fs.readFileSync(f, "utf8")) }));

describe("profiles.phone is never used as proof of verification", () => {
  it("scans a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no application code selects a phone column from any table", () => {
    const offenders = files.filter(({ code }) => /\.select\(\s*["'`][^"'`]*\bphone\b/.test(code)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("no application code writes a phone value into profiles (update/insert/upsert payloads)", () => {
    const offenders = files
      .filter(({ code }) => /\.(update|insert|upsert)\(\s*\{[^}]*\bphone\b/.test(code))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("no application code reads a profile/overview 'phone' property", () => {
    const offenders = files.filter(({ code }) => /\b(profile|overview|profiles?Row|account)\.phone\b/.test(code)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("phone_confirmed_at is only ever READ off the Auth user in application code — never assigned or written", () => {
    const offenders = files
      .filter(({ code }) => /phone_confirmed_at\s*[:=](?!=)/.test(code) && !/phone_confirmed_at\s*[!=]=/.test(code))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("the profile form no longer has a phone input — the only phone field lives in the verified OTP flow", () => {
    const withPhoneInput = files.filter(({ code }) => /name=["']phone["']/.test(code)).map((f) => f.file);
    expect(withPhoneInput).toEqual(["app/account/verification/PhoneVerification.tsx"]);
  });

  it("only the phone module and the Auth-backed status ever consult an Auth user's phone fields", () => {
    const readers = files
      .filter(({ code }) => /\b(?:user|fresh)\.(?:phone|new_phone|phone_confirmed_at)\b/.test(code))
      .map((f) => f.file)
      .sort();
    expect(readers).toEqual(["server/phone/actions.ts", "server/verification/getVerificationStatus.ts"]);
  });
});
