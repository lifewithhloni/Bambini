import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

/**
 * Static guards for the Send SMS Hook: it must stay a thin, isolated,
 * transport-only endpoint. These read source files rather than run them.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HOOK_DIR = "src/server/phone/hook";
const hookFiles = fs
  .readdirSync(path.join(ROOT, HOOK_DIR))
  .filter((f) => /\.ts$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => ({ file: `${HOOK_DIR}/${f}`, code: stripComments(read(`${HOOK_DIR}/${f}`)) }));
const routeFile = "src/app/api/hooks/send-sms/route.ts";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe("AD. the hook route is excluded from src/proxy.ts (no session refresh inside a 5s budget)", () => {
  it("proxy matcher skips /api/hooks/* but still covers ordinary pages and the other API routes", async () => {
    const { config } = await import("@/proxy");
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/api/hooks/send-sms")).toBe(false);
    expect(matcher.test("/api/hooks/anything/else")).toBe(false);
    expect(matcher.test("/account/verification")).toBe(true);
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/api/payments/payfast/webhook")).toBe(true); // unchanged by this phase
  });

  it("the route lives under the excluded prefix and delegates to the handler", () => {
    expect(fs.existsSync(path.join(ROOT, routeFile))).toBe(true);
    const code = stripComments(read(routeFile));
    expect(code).toMatch(/handleSendSmsHook/);
    expect(code).toMatch(/export async function POST/);
    expect(code).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
  });
});

describe("the hook is transport-only and cannot verify anyone", () => {
  it("no hook source touches auth.users, writes any table, or references phone_confirmed_at", () => {
    for (const { file, code } of [...hookFiles, { file: routeFile, code: stripComments(read(routeFile)) }]) {
      expect(code, file).not.toMatch(/phone_confirmed_at/);
      expect(code, file).not.toMatch(/\.from\(/);
      expect(code, file).not.toMatch(/\.auth\.(admin|updateUser|verifyOtp|resend)/);
      expect(code, file).not.toMatch(/updateUserById|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("the destination is sms.phone; user.phone is never read", () => {
    const payload = hookFiles.find((f) => f.file.endsWith("parseHookPayload.ts"))!.code;
    expect(payload).toMatch(/data\.sms\.phone/);
    for (const { file, code } of hookFiles) {
      expect(code, file).not.toMatch(/user\.phone\b/);
      expect(code, file).not.toMatch(/new_phone/);
    }
  });

  it("nothing in the hook logs", () => {
    for (const { file, code } of hookFiles) expect(code, file).not.toMatch(/console\.(log|info|warn|error|debug|trace)/);
  });

  it("server-side modules are marked server-only (can't be bundled into client code)", () => {
    for (const name of ["config", "handleSendSmsHook", "hookThrottle", "smsMessenger", "verifyHookSignature"]) {
      expect(read(`${HOOK_DIR}/${name}.ts`)).toMatch(/import "server-only"/);
    }
  });

  it("the hook reuses the 15A.1 normalizer and throttle store instead of duplicating them", () => {
    const handler = hookFiles.find((f) => f.file.endsWith("handleSendSmsHook.ts"))!.code;
    expect(handler).toMatch(/normalizeSouthAfricanMobile/);
    const throttle = hookFiles.find((f) => f.file.endsWith("hookThrottle.ts"))!.code;
    expect(throttle).toMatch(/throttleSubject/);
    for (const { file, code } of hookFiles) {
      expect(code, file).not.toMatch(/\[67\]\\d|\^\(\?:/); // no second copy of the prefix rule
    }
  });
});

describe("secrets are server-only and absent from the repository", () => {
  it("no provider/hook/throttle secret is ever a NEXT_PUBLIC_ variable, anywhere in src or the env example", () => {
    const files = [...walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f)), path.join(ROOT, ".env.example")];
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_(SMSMESSENGER|SEND_SMS|PHONE_THROTTLE|PHONE_GLOBAL|SUPABASE_SERVICE)/);
    }
  });

  it(".env.example documents the variables only as commented-out, empty placeholders", () => {
    const env = read(".env.example");
    for (const name of ["SEND_SMS_HOOK_SECRET", "SMSMESSENGER_EMAIL", "SMSMESSENGER_API_TOKEN", "PHONE_THROTTLE_HASH_SECRET"]) {
      expect(env).toMatch(new RegExp(`^# ${name}=$`, "m"));
      expect(env).not.toMatch(new RegExp(`^${name}=.+`, "m"));
    }
  });

  it("supabase/config.toml's local hook block is OFF, references its secret via env(), and holds no literal secret", () => {
    const toml = read("supabase/config.toml");
    const start = toml.indexOf("[auth.hook.send_sms]");
    expect(start).toBeGreaterThan(-1);
    const rest = toml.slice(start + "[auth.hook.send_sms]".length);
    const next = rest.search(/^\[/m);
    const section = (next === -1 ? rest : rest.slice(0, next))
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(section).toMatch(/^enabled = false$/m);
    expect(section).toMatch(/^secrets = "env\(SEND_SMS_HOOK_SECRET\)"$/m);
    expect(section).toMatch(/host\.docker\.internal/);
    expect(toml).not.toMatch(/whsec_[A-Za-z0-9+/=]{8,}/);
    expect(toml).toMatch(/NEVER apply this file to a hosted project \(supabase config push\): the/);
  });

  it("no SMSMessenger credential or hook secret is committed anywhere in source, tests or docs", () => {
    const candidates = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "tests")), ...["ENVIRONMENT.md", "DEPLOYMENT.md", "SMOKE_TESTS.md", "DECISIONS.md", ".env.example"].map((f) => path.join(ROOT, f))];
    for (const f of candidates) {
      const text = fs.readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/whsec_[A-Za-z0-9+/]{20,}={0,2}/);
      expect(text, f).not.toMatch(/SMSMESSENGER_API_TOKEN\s*=\s*["']?[A-Za-z0-9]{8,}/);
    }
  });
});

describe("delivery-report webhooks are intentionally NOT implemented", () => {
  it("the only API routes are PayFast and the Send SMS hook — no SMSMessenger callback endpoint", () => {
    const routes = walk(path.join(ROOT, "src/app/api"))
      .filter((f) => /route\.ts$/.test(f))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(routes).toEqual(["src/app/api/hooks/send-sms/route.ts", "src/app/api/payments/payfast/webhook/route.ts"]);
  });

  it("no delivery-callback checksum/nonce handling exists in the source", () => {
    for (const f of walk(path.join(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts") && !p.endsWith("hookGuard.test.ts"))) {
      expect(stripComments(fs.readFileSync(f, "utf8")), f).not.toMatch(/nonce-date|hmac-sha1|createHmac\(\s*["']sha1/i);
    }
  });

  it("the hook adds no database objects: no migration after the 15A.1 phone migrations mentions the hook or its throttle namespaces", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const after = fs.readdirSync(dir).filter((f) => f > "20261016090100_revoke_client_write_profiles_phone.sql");
    for (const f of after) {
      expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/send_sms|sms hook|huser:|dest:|global:sms|phone_throttle/i);
    }
    // And the two 15A.1 phone migrations are the only phone-throttle migrations.
    const phone = fs.readdirSync(dir).filter((f) => /phone/i.test(f));
    expect(phone).toEqual(["20261016090000_phone_verification_throttle.sql", "20261016090100_revoke_client_write_profiles_phone.sql"]);
  });
});

describe("AF. the 15A.1 action-level throttles remain intact", () => {
  it("limits are unchanged", async () => {
    const { PHONE_LIMITS } = await import("../types");
    expect(PHONE_LIMITS.send).toEqual({ userCooldownSeconds: 60, userMax: 5, userWindowSeconds: 3600, ipMax: 20, ipWindowSeconds: 3600 });
    expect(PHONE_LIMITS.verify).toEqual({ userMax: 5, userWindowSeconds: 900, ipMax: 30, ipWindowSeconds: 3600 });
  });

  it("the server actions still call the action-level throttles before Auth", () => {
    const actions = stripComments(read("src/server/phone/actions.ts"));
    expect(actions).toMatch(/throttleSend\(user\.id\)/);
    expect(actions).toMatch(/throttleVerify\(user\.id\)/);
    expect(actions.indexOf("throttleSend(user.id)")).toBeLessThan(actions.indexOf("auth.updateUser"));
    expect(actions.indexOf("throttleVerify(user.id)")).toBeLessThan(actions.indexOf("auth.verifyOtp"));
  });

  it("the action-level throttle functions and their subject namespaces (user:/ip:) are unchanged", () => {
    const t = stripComments(read("src/server/phone/throttle.ts"));
    expect(t).toMatch(/export async function throttleSend/);
    expect(t).toMatch(/export async function throttleVerify/);
    expect(t).toMatch(/`user:\$\{userId\}`/);
    expect(t).toMatch(/`ip:\$\{/);
  });
});
