import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const throttleSubjectMock = vi.fn();
vi.mock("../throttle", () => ({ throttleSubject: throttleSubjectMock }));

const reportMock = vi.fn();
vi.mock("@/lib/monitoring/reportOperationalFailure", () => ({ reportOperationalFailure: reportMock }));

const fetchMock = vi.fn();

const { handleSendSmsHook } = await import("./handleSendSmsHook");

// --- fixtures (all generated or obviously fake; nothing real) -------------
const OTP = "123456";
const NEW_PHONE = "+27831234567"; // sms.phone — the number the code is for
const OLD_PHONE = "27829999999"; // user.phone — the user's previous number, must never be texted
const USER_ID = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
const SMS_EMAIL = "sms-account@example.test";
const SMS_TOKEN = "tok-SENTINEL-not-a-real-token";
const HASH_SECRET = "hash-secret-SENTINEL-0123456789";
const URL = "https://bambini.test/api/hooks/send-sms";

const base64Key = randomBytes(32).toString("base64");
const HOOK_SECRET = `v1,whsec_${base64Key}`;

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: USER_ID, email: "parent@example.test", phone: OLD_PHONE, is_anonymous: false, new_phone: NEW_PHONE.slice(1) },
    sms: { otp: OTP, phone: NEW_PHONE },
    ...overrides,
  };
}

/** Standard Webhooks signing, written independently of the library the handler uses. */
function signed(bodyOrObject: unknown, opts: { ts?: number; id?: string; key?: string; tamper?: boolean } = {}): Request {
  const body = typeof bodyOrObject === "string" ? bodyOrObject : JSON.stringify(bodyOrObject);
  const id = opts.id ?? "msg_test_1";
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const key = opts.key ?? base64Key;
  const sig = `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sig },
    body: opts.tamper ? body.replace(OTP, "999999") : body,
  });
}

const providerOk = () => new Response(JSON.stringify({ messageId: "4635029", error: null }), { status: 200 });

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  for (const m of [throttleSubjectMock, reportMock, fetchMock]) m.mockReset();
  throttleSubjectMock.mockResolvedValue({ allowed: true });
  fetchMock.mockImplementation(async () => providerOk());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("SEND_SMS_HOOK_SECRET", HOOK_SECRET);
  vi.stubEnv("SMSMESSENGER_EMAIL", SMS_EMAIL);
  vi.stubEnv("SMSMESSENGER_API_TOKEN", SMS_TOKEN);
  vi.stubEnv("PHONE_THROTTLE_HASH_SECRET", HASH_SECRET);
  vi.stubEnv("PHONE_GLOBAL_SMS_HOURLY_LIMIT", "");
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function bodyOf(res: Response) {
  return (await res.json()) as { error?: { http_code: number; message: string } };
}

function expectNoProviderCall() {
  expect(fetchMock).not.toHaveBeenCalled();
}

describe("A. valid signed request", () => {
  it("returns 200 {} and sends exactly one SMS", async () => {
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("B/C/D. request authenticity (forgery, unsigned, replay)", () => {
  it("B. rejects a forged request signed with the wrong secret — 401, nothing sent, store untouched", async () => {
    const res = await handleSendSmsHook(signed(basePayload(), { key: randomBytes(32).toString("base64") }));
    expect(res.status).toBe(401);
    expectNoProviderCall();
    expect(throttleSubjectMock).not.toHaveBeenCalled();
  });

  it("B. rejects a body altered after signing", async () => {
    const res = await handleSendSmsHook(signed(basePayload(), { tamper: true }));
    expect(res.status).toBe(401);
    expectNoProviderCall();
  });

  it("C. rejects unsigned requests (no webhook-* headers) and requests missing any one header", async () => {
    const unsigned = new Request(URL, { method: "POST", body: JSON.stringify(basePayload()) });
    expect((await handleSendSmsHook(unsigned)).status).toBe(401);

    for (const drop of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const req = signed(basePayload());
      const headers = new Headers(req.headers);
      headers.delete(drop);
      const res = await handleSendSmsHook(new Request(URL, { method: "POST", headers, body: JSON.stringify(basePayload()) }));
      expect(res.status).toBe(401);
    }
    expectNoProviderCall();
  });

  it("D. rejects a replayed/stale request (timestamp more than 5 minutes old) and one dated in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await handleSendSmsHook(signed(basePayload(), { ts: now - 11 * 60 }))).status).toBe(401);
    expect((await handleSendSmsHook(signed(basePayload(), { ts: now + 11 * 60 }))).status).toBe(401);
    expectNoProviderCall();
    expect((await handleSendSmsHook(signed(basePayload(), { ts: now - 4 * 60 }))).status).toBe(200);
  });

  it("fails closed (500, nothing sent) when the hook secret is not configured at all", async () => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", "");
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(500);
    expectNoProviderCall();
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized body before doing any work (Supabase's cap is 20KB)", async () => {
    const big = JSON.stringify({ ...basePayload(), pad: "x".repeat(25_000) });
    const res = await handleSendSmsHook(signed(big));
    expect(res.status).toBe(400);
    expectNoProviderCall();
  });
});

describe("E–H. payload validation fails closed", () => {
  it("E. malformed payloads are 400 and send nothing", async () => {
    for (const body of ["not json", "[]", "null", "{}", '"string"', JSON.stringify({ user: {}, sms: {} }), JSON.stringify({ user: "x", sms: "y" })]) {
      expect((await handleSendSmsHook(signed(body))).status).toBe(400);
    }
    expectNoProviderCall();
  });

  it("F. missing sms.phone — even when user.phone is a perfectly valid SA number (never falls back to it)", async () => {
    const payload = basePayload({ sms: { otp: OTP } });
    expect((payload.user as { phone: string }).phone).toBe(OLD_PHONE);
    const res = await handleSendSmsHook(signed(payload));
    expect(res.status).toBe(400);
    expectNoProviderCall();
  });

  it("F. missing sms object entirely, or missing user object", async () => {
    expect((await handleSendSmsHook(signed({ user: basePayload().user }))).status).toBe(400);
    expect((await handleSendSmsHook(signed({ sms: basePayload().sms }))).status).toBe(400);
    expectNoProviderCall();
  });

  it("G. missing or wrongly formatted sms.otp", async () => {
    for (const otp of [undefined, "", "12345", "1234567", "abcdef", "12 456", "١٢٣٤٥٦", 123456]) {
      const sms = otp === undefined ? { phone: NEW_PHONE } : { phone: NEW_PHONE, otp };
      expect((await handleSendSmsHook(signed(basePayload({ sms })))).status).toBe(400);
    }
    expectNoProviderCall();
  });

  it("H. missing/empty user.email — a phone-only or anonymous account cannot spend SMS", async () => {
    const withoutEmail = { id: USER_ID, phone: OLD_PHONE };
    expect((await handleSendSmsHook(signed(basePayload({ user: withoutEmail })))).status).toBe(400);
    expect((await handleSendSmsHook(signed(basePayload({ user: { ...withoutEmail, email: "" } })))).status).toBe(400);
    expect((await handleSendSmsHook(signed(basePayload({ user: { ...withoutEmail, email: "   " } })))).status).toBe(400);
    expect((await handleSendSmsHook(signed(basePayload({ user: { id: USER_ID, email: "parent@example.test", is_anonymous: true } })))).status).toBe(400);
    expectNoProviderCall();
    expect(throttleSubjectMock).not.toHaveBeenCalled();
  });

  it("missing user.id", async () => {
    expect((await handleSendSmsHook(signed(basePayload({ user: { email: "parent@example.test" } })))).status).toBe(400);
    expectNoProviderCall();
  });
});

describe("I/J. destination must be a South African mobile", () => {
  it("I. non-SA numbers cannot trigger SMS (no international sending)", async () => {
    for (const phone of ["+14155552671", "+447911123456", "+264811234567", "14155552671", "+2348012345678"]) {
      expect((await handleSendSmsHook(signed(basePayload({ sms: { otp: OTP, phone } })))).status).toBe(400);
    }
    expectNoProviderCall();
    expect(throttleSubjectMock).not.toHaveBeenCalled();
  });

  it("J. invalid destinations (garbage, landline, 080/086/087, too short/long, injection)", async () => {
    for (const phone of ["abc", "", "0112345678", "+27112345678", "0801234567", "+27861234567", "+27871234567", "+2782123", "+278212345678901", "+27831234567; drop", "+27831234567\n+27839999999"]) {
      expect((await handleSendSmsHook(signed(basePayload({ sms: { otp: OTP, phone } })))).status).toBe(400);
    }
    expectNoProviderCall();
  });
});

describe("K/L/AE. kill switch (PHONE_VERIFICATION_ENABLED)", () => {
  it.each([undefined, "", "false", "1", "TRUE", "yes", " true"])("K. value %j: refuses with a controlled 403, never calls the provider or the throttle store", async (value) => {
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", value as unknown as string);
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
    expectNoProviderCall();
    expect(throttleSubjectMock).not.toHaveBeenCalled();
    expect((await bodyOf(res)).error?.message).toBe("Phone verification is unavailable.");
  });

  it("L. only the exact value 'true' enables sending", async () => {
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "true");
    expect((await handleSendSmsHook(signed(basePayload()))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AE. the switch is checked after authenticity, so an unsigned caller learns nothing about its state", async () => {
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "false");
    const unsigned = new Request(URL, { method: "POST", body: JSON.stringify(basePayload()) });
    expect((await handleSendSmsHook(unsigned)).status).toBe(401);
  });
});

describe("M/N/O/P. destination and provider request", () => {
  it("M/N. texts sms.phone (the NEW number), never user.phone (the old one)", async () => {
    await handleSendSmsHook(signed(basePayload()));
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body).recipientNumber).toBe("27831234567");
    expect(init.body).not.toContain("27829999999");
    expect(init.body).not.toContain(OLD_PHONE);
  });

  it("O. sends exactly the documented request body to the documented endpoint", async () => {
    await handleSendSmsHook(signed(basePayload()));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json");
    expect(init.method).toBe("POST");
    expect(init.headers.email).toBe(SMS_EMAIL);
    expect(init.headers.token).toBe(SMS_TOKEN);
    expect(init.body).toBe('{"recipientNumber":"27831234567","message":"Your Bambini verification code is 123456"}');
  });

  it("P. provider number is the exact '27…' form whatever format Auth supplied (+27…, 27…, 0…)", async () => {
    for (const phone of ["+27831234567", "27831234567", "0831234567", "+27 83 123 4567"]) {
      fetchMock.mockClear();
      const res = await handleSendSmsHook(signed(basePayload({ sms: { otp: OTP, phone } })));
      expect(res.status).toBe(200);
      const recipient = JSON.parse(fetchMock.mock.calls[0][1].body).recipientNumber as string;
      expect(recipient).toBe("27831234567");
      expect(recipient).not.toMatch(/^[+0]/);
    }
  });
});

describe("Q–T/AA/AB. provider outcomes", () => {
  it("Q. a successful provider response -> 200 {}", async () => {
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(200);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("R. provider HTTP failure -> failure to Supabase Auth (500), reported with a static reason only", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(500);
    expect(await bodyOf(res)).toEqual({ error: { http_code: 500, message: "Phone verification is unavailable." } });
    expect(reportMock).toHaveBeenCalledWith({ area: "phone_verification", reason: "sms provider send failed: http_error" });
  });

  it("S. malformed provider response (2xx but no messageId / not JSON / provider error) -> failure", async () => {
    for (const make of [
      () => new Response("OK", { status: 200 }),
      () => new Response(JSON.stringify({ error: null }), { status: 200 }),
      () => new Response(JSON.stringify({ messageId: null, error: "No credits" }), { status: 200 }),
    ]) {
      fetchMock.mockImplementation(async () => make());
      const res = await handleSendSmsHook(signed(basePayload()));
      expect(res.status).toBe(500);
    }
  });

  it("T. provider timeout -> failure within the budget (request aborted at ~3s)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    const pending = handleSendSmsHook(signed(basePayload()));
    await vi.advanceTimersByTimeAsync(3000);
    const res = await pending;
    expect(res.status).toBe(500);
    expect(reportMock).toHaveBeenCalledWith({ area: "phone_verification", reason: "sms provider send failed: timeout" });
  });

  it("provider credentials missing -> failure, nothing sent", async () => {
    vi.stubEnv("SMSMESSENGER_API_TOKEN", "");
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(500);
    expectNoProviderCall();
  });

  it("AA/AB. a failed provider request returns an error body — never the success shape — so Auth reports failure and no code is consumed or verified", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await bodyOf(res);
    expect(body).not.toEqual({});
    expect(body.error?.http_code).toBe(res.status);
  });
});

describe("AC. no retryable (429/503) response is ever produced", () => {
  it("across every outcome — success, auth failures, validation failures, kill switch, throttling, misconfiguration and every provider failure", async () => {
    const statuses: number[] = [];
    const run = async (req: Request) => statuses.push((await handleSendSmsHook(req)).status);

    await run(signed(basePayload()));
    await run(signed(basePayload(), { key: randomBytes(32).toString("base64") }));
    await run(signed("not json"));
    await run(signed(basePayload({ sms: { otp: OTP, phone: "+14155552671" } })));

    // throttled (user / destination / global) and store failure
    for (const denied of [0, 1, 2]) {
      throttleSubjectMock.mockReset();
      const calls: number[] = [];
      throttleSubjectMock.mockImplementation(async () => {
        calls.push(1);
        return calls.length - 1 === denied ? { allowed: false, retryAfterSeconds: 60 } : { allowed: true };
      });
      await run(signed(basePayload()));
    }
    throttleSubjectMock.mockReset();
    throttleSubjectMock.mockResolvedValue({ allowed: true });

    // every provider failure mode (all happen AFTER the send attempt)
    const providerFailures: Array<() => Promise<Response>> = [
      async () => new Response("{}", { status: 429 }), // provider says "slow down" — must NOT become a retryable 429 for Supabase
      async () => new Response("{}", { status: 503 }), // provider unavailable — must NOT become a retryable 503
      async () => new Response("{}", { status: 500 }),
      async () => new Response("garbage", { status: 200 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const failure of providerFailures) {
      fetchMock.mockImplementation(failure);
      const res = await handleSendSmsHook(signed(basePayload()));
      statuses.push(res.status);
      expect(res.status).toBe(500); // non-retryable, specifically
    }

    fetchMock.mockImplementation(async () => providerOk());
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "false");
    await run(signed(basePayload()));
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("SEND_SMS_HOOK_SECRET", "");
    await run(signed(basePayload()));
    vi.stubEnv("SEND_SMS_HOOK_SECRET", HOOK_SECRET);
    vi.stubEnv("PHONE_THROTTLE_HASH_SECRET", "");
    await run(signed(basePayload()));

    expect(statuses.length).toBeGreaterThan(14);
    expect(statuses).not.toContain(429);
    expect(statuses).not.toContain(503);
    expect(new Set(statuses).size).toBeGreaterThan(3);
  });
});

describe("U/V. throttling at the hook (independent of the action-level throttles)", () => {
  it("U. per-user: a user over their hook limit gets no SMS — even though this request never touched a Bambini server action", async () => {
    throttleSubjectMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 600 });
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(403);
    expect(throttleSubjectMock.mock.calls[0][0]).toBe(`huser:${USER_ID}`);
    expectNoProviderCall();
  });

  it("V. per-destination: a number over its limit gets no SMS", async () => {
    throttleSubjectMock.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 600 });
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(403);
    expect(throttleSubjectMock.mock.calls[1][0]).toMatch(/^dest:[0-9a-f]{64}$/);
    expectNoProviderCall();
  });

  it("the global spend ceiling stops all sends once reached", async () => {
    throttleSubjectMock.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 600 });
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(403);
    expect(throttleSubjectMock.mock.calls[2][0]).toBe("global:sms");
    expectNoProviderCall();
  });

  it("a missing throttle hash secret fails closed (500), never sends", async () => {
    vi.stubEnv("PHONE_THROTTLE_HASH_SECRET", "");
    const res = await handleSendSmsHook(signed(basePayload()));
    expect(res.status).toBe(500);
    expectNoProviderCall();
  });

  it("W. the throttle store only ever sees an HMAC of the destination — never the number, the code, or the provider format", async () => {
    await handleSendSmsHook(signed(basePayload()));
    const dest = throttleSubjectMock.mock.calls[1][0] as string;
    expect(dest).toBe(`dest:${createHmac("sha256", HASH_SECRET).update(NEW_PHONE).digest("hex")}`);
    const everything = JSON.stringify(throttleSubjectMock.mock.calls);
    for (const leaked of ["27831234567", "831234567", OTP]) expect(everything).not.toContain(leaked);
  });
});

describe("X/Y/Z. nothing sensitive is ever logged, reported or returned", () => {
  it("across success and every failure path: no console output, and monitoring/response bodies contain no OTP, phone, credential, secret or email", async () => {
    const responses: string[] = [];
    const record = async (req: Request) => responses.push(await (await handleSendSmsHook(req)).text());

    await record(signed(basePayload()));
    await record(signed(basePayload(), { key: randomBytes(32).toString("base64") }));
    await record(signed(basePayload({ sms: { otp: OTP, phone: "+14155552671" } })));
    for (const make of [
      async () => new Response(JSON.stringify({ error: `bad token ${SMS_TOKEN} otp ${OTP} to 27831234567 ${SMS_EMAIL}` }), { status: 500 }),
      async () => {
        throw new Error(`ECONNREFUSED ${SMS_TOKEN} ${OTP} 27831234567`);
      },
    ]) {
      fetchMock.mockImplementation(make);
      await record(signed(basePayload()));
    }
    throttleSubjectMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
    await record(signed(basePayload()));
    vi.stubEnv("PHONE_VERIFICATION_ENABLED", "false");
    await record(signed(basePayload()));

    const logged = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
    const reported = JSON.stringify(reportMock.mock.calls);
    const returned = responses.join("\n");
    const forbidden = [OTP, "27831234567", "831234567", "+27831234567", OLD_PHONE, SMS_TOKEN, SMS_EMAIL, HASH_SECRET, HOOK_SECRET, base64Key, "parent@example.test", USER_ID];

    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    for (const secret of forbidden) {
      expect(logged, `log leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
      expect(reported, `monitoring leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
      expect(returned, `response leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
    // Responses never name the provider or its internals.
    expect(returned).not.toMatch(/smsmessenger|token|webhook|secret|hmac|econnrefused/i);
  });

  it("the OTP is never persisted by Bambini: the only store traffic is throttle subjects, none containing the code", async () => {
    await handleSendSmsHook(signed(basePayload()));
    expect(JSON.stringify(throttleSubjectMock.mock.calls)).not.toContain(OTP);
  });
});

describe("the hook can only ever send an SMS — it cannot verify anyone", () => {
  it("success is exactly 200 {} with no user/phone/verification data in the body", async () => {
    const res = await handleSendSmsHook(signed(basePayload()));
    const text = await res.text();
    expect(text).toBe("{}");
    expect(text).not.toMatch(/verified|confirmed|phone_confirmed_at/i);
  });
});
