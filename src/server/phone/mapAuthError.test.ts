import { describe, expect, it } from "vitest";
import { mapPhoneAuthError, messageForSendKind } from "./mapAuthError";
import { PHONE_MESSAGES } from "./types";

describe("mapPhoneAuthError — hook-origin failures", () => {
  it.each([500, 502, 504])("a %i from Auth (what a failing Send SMS hook surfaces as) is 'unavailable', not 'couldn't send to that number'", (status) => {
    expect(mapPhoneAuthError({ status, code: "unexpected_failure", message: "Error running hook URL" })).toBe("provider_unavailable");
    expect(messageForSendKind(mapPhoneAuthError({ status }))).toBe(PHONE_MESSAGES.unavailable);
  });

  it("hook timeouts remain 'unavailable'", () => {
    expect(mapPhoneAuthError({ code: "hook_timeout" })).toBe("provider_unavailable");
    expect(mapPhoneAuthError({ code: "hook_timeout_after_retry" })).toBe("provider_unavailable");
  });

  it("user-facing messages never name the provider, hook, internals, credentials, the code or the number", () => {
    for (const status of [500, 502]) {
      const msg = messageForSendKind(mapPhoneAuthError({ status, message: "SMSMessenger token abc 27831234567 123456 webhook secret" }));
      expect(msg).not.toMatch(/smsmessenger|token|webhook|secret|hook|27831234567|123456|error running/i);
    }
  });

  it("does not disturb the existing mappings: phone_exists and 4xx validation stay generic send failures; rate limits stay rate limits", () => {
    expect(mapPhoneAuthError({ code: "phone_exists", status: 422 })).toBe("send_failed");
    expect(mapPhoneAuthError({ code: "validation_failed", status: 422 })).toBe("send_failed");
    expect(mapPhoneAuthError({ code: "over_sms_send_rate_limit", status: 429 })).toBe("rate_limited");
    expect(mapPhoneAuthError({ status: 429 })).toBe("rate_limited");
    expect(mapPhoneAuthError({ code: "otp_expired", status: 403 })).toBe("invalid_code");
    expect(mapPhoneAuthError(null)).toBe("send_failed");
    expect(mapPhoneAuthError({})).toBe("send_failed");
  });
});
