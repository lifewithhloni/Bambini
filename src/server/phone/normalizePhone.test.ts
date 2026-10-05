import { describe, expect, it, vi } from "vitest";
import { e164FromAuthPhone, formatPhoneForDisplay, normalizeSouthAfricanMobile } from "./normalizePhone";
import { phoneBadgeState } from "./uiState";

describe("normalizeSouthAfricanMobile — accepted formats all become canonical E.164", () => {
  it.each(["0821234567", "082 123 4567", "082-123-4567", "+27 82 123 4567", "27821234567", "0027 82 123 4567"])("%s -> +27821234567", (input) => {
    expect(normalizeSouthAfricanMobile(input)).toEqual({ ok: true, e164: "+27821234567" });
  });

  it("also tolerates surrounding whitespace, dots, parentheses and a non-breaking space", () => {
    expect(normalizeSouthAfricanMobile("  (082) 123.4567 ")).toEqual({ ok: true, e164: "+27821234567" });
    expect(normalizeSouthAfricanMobile("+27 82 123 4567")).toEqual({ ok: true, e164: "+27821234567" });
  });

  // The documented prefix rule (see normalizePhone.ts header): local 060–069, 070–079, 081–085.
  it.each(["0601234567", "0691234567", "0711234567", "0791234567", "0811234567", "0831234567", "0841234567", "0851234567"])(
    "accepts documented mobile prefix: %s",
    (input) => {
      expect(normalizeSouthAfricanMobile(input).ok).toBe(true);
    },
  );
});

describe("normalizeSouthAfricanMobile — rejections", () => {
  const reason = (input: unknown) => {
    const r = normalizeSouthAfricanMobile(input);
    return r.ok ? "ACCEPTED" : r.reason;
  };

  it("rejects too-short numbers", () => {
    expect(reason("082123456")).toBe("invalid_length");
    expect(reason("0821")).toBe("invalid_length");
    expect(reason("+27")).toBe("invalid_length");
  });

  it("rejects too-long numbers", () => {
    expect(reason("08212345678")).toBe("invalid_length");
    expect(reason("+27821234567890")).toBe("invalid_length");
    expect(reason("0".repeat(40))).toBe("malformed");
  });

  it("rejects letters", () => {
    expect(reason("082abc4567")).toBe("malformed");
    expect(reason("call me")).toBe("malformed");
    expect(reason("0821234567x")).toBe("malformed");
  });

  it("rejects non-South-African country codes", () => {
    expect(reason("+14155552671")).toBe("not_south_african");
    expect(reason("+447911123456")).toBe("not_south_african");
    expect(reason("+264811234567")).toBe("not_south_african");
    expect(reason("0044 7911 123456")).toBe("not_south_african");
    expect(reason("0014155552671")).toBe("not_south_african");
  });

  it("rejects landline ranges", () => {
    expect(reason("0112345678")).toBe("not_mobile"); // Johannesburg
    expect(reason("0215551234")).toBe("not_mobile"); // Cape Town
    expect(reason("0312345678")).toBe("not_mobile"); // Durban
    expect(reason("+27 12 345 6789")).toBe("not_mobile"); // Pretoria
  });

  it("rejects the 080, 086 and 087 ranges and other non-mobile blocks", () => {
    expect(reason("0801234567")).toBe("not_mobile"); // toll-free
    expect(reason("0861234567")).toBe("not_mobile"); // shared-cost / premium
    expect(reason("0871234567")).toBe("not_mobile"); // VoIP / personal numbering
    expect(reason("0861111111")).toBe("not_mobile");
    expect(reason("0901234567")).toBe("not_mobile");
    expect(reason("0501234567")).toBe("not_mobile");
    expect(reason("0891234567")).toBe("not_mobile");
  });

  it("rejects malformed +27 values (trunk zero kept, stray plus, missing zero, doubled code)", () => {
    expect(reason("+270821234567")).toBe("invalid_length"); // trunk 0 after the country code
    expect(reason("+27 (0) 82 123 4567")).toBe("invalid_length");
    expect(reason("27+821234567")).toBe("malformed");
    expect(reason("+27+821234567")).toBe("malformed");
    expect(reason("++27821234567")).toBe("malformed");
    expect(reason("+2727821234567")).toBe("invalid_length");
    expect(reason("821234567")).toBe("malformed"); // no trunk zero / country code
    expect(reason("+")).toBe("malformed");
  });

  it("rejects empty and whitespace-only input", () => {
    expect(reason("")).toBe("empty");
    expect(reason("   ")).toBe("empty");
    expect(reason("   ")).toBe("empty");
  });

  it("rejects non-string input", () => {
    expect(reason(null)).toBe("malformed");
    expect(reason(undefined)).toBe("malformed");
    expect(reason(821234567)).toBe("malformed");
    expect(reason({ toString: () => "0821234567" })).toBe("malformed");
    expect(reason(["0821234567"])).toBe("malformed");
  });

  it("rejects control characters and injection payloads", () => {
    expect(reason("0821234567\n")).toBe("ACCEPTED"); // trailing newline is trimmed whitespace, still a clean number…
    expect(reason("082\n1234567")).toBe("malformed"); // …but one inside the number is not
    expect(reason("082\t1234567")).toBe("malformed");
    expect(reason("082\u00001234567")).toBe("malformed");
    expect(reason("0821234567\r\n+27821234568")).toBe("malformed");
    expect(reason("0821234567'; drop table profiles;--")).toBe("malformed");
    expect(reason("0821234567 OR 1=1")).toBe("malformed");
    expect(reason("<script>alert(1)</script>")).toBe("malformed");
    expect(reason("0821234567%0a")).toBe("malformed");
    expect(reason("+27821234567‮")).toBe("malformed"); // right-to-left override
    expect(reason("０８２１２３４５６７")).toBe("malformed"); // full-width digits
  });

  it("never throws and never echoes the input in its result", () => {
    const secret = "082-NOT-A-NUMBER-9999";
    const r = normalizeSouthAfricanMobile(secret);
    expect(JSON.stringify(r)).not.toContain("9999");
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it("never logs, whatever the input", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    for (const input of ["0821234567", "garbage", "", "+14155552671", "0112345678", null]) normalizeSouthAfricanMobile(input);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("e164FromAuthPhone — Auth stores the phone without '+'", () => {
  it("maps Auth's stored form to canonical E.164", () => {
    expect(e164FromAuthPhone("27821234567")).toBe("+27821234567");
    expect(e164FromAuthPhone("+27821234567")).toBe("+27821234567");
  });

  it("returns null for absent or non-South-African values", () => {
    expect(e164FromAuthPhone(null)).toBeNull();
    expect(e164FromAuthPhone(undefined)).toBeNull();
    expect(e164FromAuthPhone("")).toBeNull();
    expect(e164FromAuthPhone("14155552671")).toBeNull();
  });
});

describe("formatPhoneForDisplay", () => {
  it("groups a canonical number for display", () => {
    expect(formatPhoneForDisplay("+27821234567")).toBe("+27 82 123 4567");
  });
  it("leaves anything unexpected untouched", () => {
    expect(formatPhoneForDisplay("garbage")).toBe("garbage");
  });
});

describe("phoneBadgeState — the UI cannot claim verified without confirmed Auth state", () => {
  it("is 'verified' only when Auth's phone_confirmed_at is set", () => {
    for (const phoneVerificationAvailable of [true, false]) {
      for (const pendingPhone of [null, "+27821234567"]) {
        expect(phoneBadgeState({ phoneConfirmed: true, phoneVerificationAvailable, pendingPhone })).toBe("verified");
        expect(phoneBadgeState({ phoneConfirmed: false, phoneVerificationAvailable, pendingPhone })).not.toBe("verified");
      }
    }
  });

  it("an unconfirmed phone is 'unavailable' when the flow is off, never verified", () => {
    expect(phoneBadgeState({ phoneConfirmed: false, phoneVerificationAvailable: false, pendingPhone: null })).toBe("unavailable");
  });

  it("an unconfirmed phone with a code outstanding is 'awaiting_code', otherwise 'not_verified'", () => {
    expect(phoneBadgeState({ phoneConfirmed: false, phoneVerificationAvailable: true, pendingPhone: "+27821234567" })).toBe("awaiting_code");
    expect(phoneBadgeState({ phoneConfirmed: false, phoneVerificationAvailable: true, pendingPhone: null })).toBe("not_verified");
  });
});
