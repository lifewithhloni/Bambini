import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();

const { sendOtpSms, toProviderNumber, buildOtpMessage, SMSMESSENGER_SEND_URL, SMSMESSENGER_TIMEOUT_MS } = await import("./smsMessenger");

const E164 = "+27821234567";
const OTP = "123456";
const EMAIL = "sms-account@example.test";
const TOKEN = "tok-SENTINEL-not-a-real-token";

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SMSMESSENGER_EMAIL", EMAIL);
  vi.stubEnv("SMSMESSENGER_API_TOKEN", TOKEN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("request shape", () => {
  it("POSTs the documented endpoint with email/token headers and exactly { recipientNumber, message }", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "4635029", error: null }));
    await sendOtpSms({ e164: E164, otp: OTP });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json");
    expect(url).toBe(SMSMESSENGER_SEND_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.email).toBe(EMAIL);
    expect(init.headers.token).toBe(TOKEN);
    expect(JSON.parse(init.body)).toEqual({ recipientNumber: "27821234567", message: "Your Bambini verification code is 123456" });
    expect(Object.keys(JSON.parse(init.body))).toEqual(["recipientNumber", "message"]);
    expect(init.body).toBe('{"recipientNumber":"27821234567","message":"Your Bambini verification code is 123456"}');
  });

  it("sends no campaign/dataField (they would be echoed in delivery reports and the provider dashboard)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "1", error: null }));
    await sendOtpSms({ e164: E164, otp: OTP });
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).not.toMatch(/campaign|dataField|dateToSend/);
  });

  it("converts to the provider's exact number format: no '+', no leading 0", () => {
    expect(toProviderNumber("+27821234567")).toBe("27821234567");
    expect(toProviderNumber("+27821234567")).not.toMatch(/^[+0]/);
    expect(buildOtpMessage("654321")).toBe("Your Bambini verification code is 654321");
  });

  it("never follows redirects (a redirect could replay the credentials headers to another host) and never caches", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "1", error: null }));
    await sendOtpSms({ e164: E164, otp: OTP });
    const init = fetchMock.mock.calls[0][1];
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("response validation — a 2xx alone is not success", () => {
  it("success: OK + messageId + null error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "4635029", error: null }));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: true });
  });

  it("accepts a numeric messageId and an omitted error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: 4635029 }));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: true });
  });

  it.each([400, 401, 403, 429, 500, 502, 503])("HTTP %i is a failure (http_error)", async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "1", error: null }, { status }));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "http_error" });
  });

  it("a 200 carrying a provider error is a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: null, error: "Insufficient credits" }));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "provider_error" });
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "123", error: "something" }));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "provider_error" });
  });

  it.each([
    ["a non-JSON body", () => new Response("<html>ok</html>", { status: 200 })],
    ["an empty body", () => new Response("", { status: 200 })],
    ["a JSON array", () => jsonResponse([{ messageId: "1" }])],
    ["JSON null", () => jsonResponse(null)],
    ["no messageId", () => jsonResponse({ error: null })],
    ["an empty messageId", () => jsonResponse({ messageId: "  ", error: null })],
    ["a non-scalar messageId", () => jsonResponse({ messageId: { id: 1 }, error: null })],
  ])("%s is a failure (malformed_response)", async (_name, make) => {
    fetchMock.mockImplementation(async () => make());
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "malformed_response" });
  });

  it("a network failure is a failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "network" });
  });

  it("fails closed without calling the provider when credentials are not configured", async () => {
    vi.stubEnv("SMSMESSENGER_API_TOKEN", "");
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "not_configured" });
    vi.stubEnv("SMSMESSENGER_API_TOKEN", TOKEN);
    vi.stubEnv("SMSMESSENGER_EMAIL", "");
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: false, kind: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("timeout", () => {
  it("aborts a hung provider request after ~3 seconds and reports a timeout (well inside Supabase's 5s hook budget)", async () => {
    expect(SMSMESSENGER_TIMEOUT_MS).toBe(3000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );

    const pending = sendOtpSms({ e164: E164, otp: OTP });
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ ok: false, kind: "timeout" });
  });

  it("clears its timer after a normal response (no dangling timers)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockResolvedValue(jsonResponse({ messageId: "1", error: null }));
    expect(await sendOtpSms({ e164: E164, otp: OTP })).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("never logs", () => {
  it("emits no console output on success or any failure, and failure results never contain the code, number or credentials", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const results: unknown[] = [];

    fetchMock.mockResolvedValue(jsonResponse({ messageId: "1", error: null }));
    results.push(await sendOtpSms({ e164: E164, otp: OTP }));
    fetchMock.mockResolvedValue(jsonResponse({ error: `bad token ${TOKEN} for ${OTP} 27821234567` }, { status: 500 }));
    results.push(await sendOtpSms({ e164: E164, otp: OTP }));
    fetchMock.mockResolvedValue(jsonResponse({ messageId: null, error: `credit ${TOKEN} ${OTP}` }));
    results.push(await sendOtpSms({ e164: E164, otp: OTP }));
    fetchMock.mockRejectedValue(new Error(`connect ECONNREFUSED ${TOKEN} ${OTP} ${EMAIL} 27821234567`));
    results.push(await sendOtpSms({ e164: E164, otp: OTP }));

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    const out = JSON.stringify(results);
    for (const secret of [TOKEN, OTP, EMAIL, "27821234567", "821234567"]) expect(out).not.toContain(secret);
  });
});
