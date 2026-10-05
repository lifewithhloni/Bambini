import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * [auth.sms.test_otp] gives a phone number a FIXED one-time code. That is
 * a local/test convenience and, on a hosted project, a verification
 * backdoor for that number. These checks make sure it can't quietly widen
 * or travel: it may list only the single documented fixture number, no
 * script or workflow may push config to a hosted project, it is never an
 * environment variable, and no application code special-cases it.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const FIXTURE_ENTRY = '27820000001 = "123456"';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("[auth.sms.test_otp] cannot become a production verification backdoor", () => {
  it("lists exactly one entry — the documented fixture number — and nothing else", () => {
    const toml = read("supabase/config.toml");
    const start = toml.indexOf("[auth.sms.test_otp]");
    expect(start).toBeGreaterThan(-1);
    const rest = toml.slice(start + "[auth.sms.test_otp]".length);
    const nextSection = rest.search(/^\[/m);
    const body = nextSection === -1 ? rest : rest.slice(0, nextSection);
    const entries = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(entries).toEqual([FIXTURE_ENTRY]);
  });

  it("is labelled LOCAL / TEST ONLY and warns against pushing it to a hosted project, in the config itself", () => {
    const toml = read("supabase/config.toml");
    const section = toml.slice(toml.indexOf("[auth.sms.test_otp]"));
    expect(section).toMatch(/LOCAL \/ TEST ONLY/);
    expect(section).toMatch(/NEVER apply this file to a hosted project/);
  });

  it("no SMS provider block or credential exists in config.toml", () => {
    const toml = read("supabase/config.toml");
    expect(toml).not.toMatch(/^\[auth\.sms\.(twilio|twilio_verify|messagebird|textlocal|vonage)\]/m);
    expect(toml).not.toMatch(/auth_token|account_sid|message_service_sid|api_secret/i);
  });

  it("ENVIRONMENT.md explicitly warns against using it in hosted production", () => {
    const doc = read("ENVIRONMENT.md");
    expect(doc).toMatch(/test_otp.*local\/test only/);
    expect(doc).toMatch(/never use it in hosted production/i);
    expect(doc).toMatch(/verification backdoor/);
  });

  it("no package script, workflow or Vercel config pushes Supabase config to a hosted project", () => {
    const targets = ["package.json", "vercel.json"].filter((f) => fs.existsSync(path.join(ROOT, f)));
    const wfDir = path.join(ROOT, ".github/workflows");
    const workflows = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).map((f) => `.github/workflows/${f}`) : [];
    for (const rel of [...targets, ...workflows]) {
      expect(read(rel), rel).not.toMatch(/supabase[^\n]*config\s+push/);
      expect(read(rel), rel).not.toMatch(/test_otp/i);
    }
  });

  it("is not an environment variable anywhere in the documented env surface", () => {
    expect(read(".env.example")).not.toMatch(/test_otp/i);
    const envTs = read("src/config/env.ts");
    expect(envTs).not.toMatch(/test_otp/i);
    expect(envTs).not.toMatch(/OTP/);
  });

  it("no application code references test_otp or the fixture number (no special-casing of a fixed code)", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => /test_otp|27820000001/i.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
