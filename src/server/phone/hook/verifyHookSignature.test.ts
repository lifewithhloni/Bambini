import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { verifySupabaseHookSignature } = await import("./verifyHookSignature");

/** Independent Standard Webhooks signer (written from the spec, not the library under test). */
function signer() {
  const base64 = randomBytes(32).toString("base64");
  const secret = `v1,whsec_${base64}`;
  const sign = (id: string, timestamp: number, body: string, key = base64) =>
    `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  return { base64, secret, sign };
}

const now = () => Math.floor(Date.now() / 1000);

function headersFor(id: string | null, ts: number | null, sig: string | null) {
  const h = new Headers();
  if (id !== null) h.set("webhook-id", id);
  if (ts !== null) h.set("webhook-timestamp", String(ts));
  if (sig !== null) h.set("webhook-signature", sig);
  return h;
}

describe("verifySupabaseHookSignature (Standard Webhooks)", () => {
  const body = '{"user":{"id":"u"},"sms":{"otp":"123456"}}';

  it("accepts a correctly signed request", () => {
    const { secret, sign } = signer();
    const ts = now();
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, sign("msg_1", ts, body)), secret)).toBe(true);
  });

  it("accepts when one of several space-separated signatures is valid (key rotation)", () => {
    const { secret, sign } = signer();
    const ts = now();
    const good = sign("msg_1", ts, body);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${good}`), secret)).toBe(true);
  });

  it("rejects a request signed with a different secret (forged request)", () => {
    const real = signer();
    const attacker = signer();
    const ts = now();
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, attacker.sign("msg_1", ts, body)), real.secret)).toBe(false);
  });

  it("rejects when the body was altered after signing", () => {
    const { secret, sign } = signer();
    const ts = now();
    const sig = sign("msg_1", ts, body);
    expect(verifySupabaseHookSignature(body.replace("123456", "654321"), headersFor("msg_1", ts, sig), secret)).toBe(false);
  });

  it("rejects when the id or timestamp was altered (they are part of the signed content)", () => {
    const { secret, sign } = signer();
    const ts = now();
    const sig = sign("msg_1", ts, body);
    expect(verifySupabaseHookSignature(body, headersFor("msg_2", ts, sig), secret)).toBe(false);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts + 1, sig), secret)).toBe(false);
  });

  it("rejects unsigned requests: every one of the three headers is required", () => {
    const { secret, sign } = signer();
    const ts = now();
    const sig = sign("msg_1", ts, body);
    expect(verifySupabaseHookSignature(body, headersFor(null, ts, sig), secret)).toBe(false);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", null, sig), secret)).toBe(false);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, null), secret)).toBe(false);
    expect(verifySupabaseHookSignature(body, new Headers(), secret)).toBe(false);
  });

  it("rejects stale AND future-dated timestamps beyond the 5-minute tolerance (replay protection), accepts inside it", () => {
    const { secret, sign } = signer();
    const at = (offset: number) => {
      const ts = now() + offset;
      return verifySupabaseHookSignature(body, headersFor("msg_1", ts, sign("msg_1", ts, body)), secret);
    };
    expect(at(-60)).toBe(true);
    expect(at(-240)).toBe(true);
    expect(at(-6 * 60)).toBe(false);
    expect(at(-3600)).toBe(false);
    expect(at(6 * 60)).toBe(false);
  });

  it("rejects malformed signatures and timestamps without throwing", () => {
    const { secret } = signer();
    const ts = now();
    for (const sig of ["garbage", "v1,", "v1,not-base64!!!", "v2,AAAA", ",", " "]) {
      expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, sig), secret)).toBe(false);
    }
    expect(verifySupabaseHookSignature(body, new Headers({ "webhook-id": "m", "webhook-timestamp": "not-a-number", "webhook-signature": "v1,AAAA" }), secret)).toBe(false);
  });

  it("fails closed with a missing, empty, or wrongly formatted secret", () => {
    const { base64, sign } = signer();
    const ts = now();
    const sig = sign("msg_1", ts, body);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, sig), null)).toBe(false);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, sig), "")).toBe(false);
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, sig), "v1,whsec_")).toBe(false);
    // The bare base64 (without Supabase's documented "v1,whsec_" prefix) is not accepted.
    expect(verifySupabaseHookSignature(body, headersFor("msg_1", ts, sig), base64)).toBe(false);
  });
});
