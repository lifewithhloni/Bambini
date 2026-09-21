import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPayFastParamString, generatePayFastSignature, payFastUrlEncode, verifyPayFastSignature } from "./signature";

/**
 * No officially-published (input -> expected signature) pair from
 * PayFast was available to test against in this environment (their
 * docs show a signature *value* as a generic formatting example, not
 * tied to a disclosed input set) — these tests verify the documented
 * *algorithm* (field order, blank-value exclusion, passphrase
 * handling, PHP urlencode()'s specific safe-character set) rather than
 * asserting a hash value as "the official PayFast answer." Where an
 * exact hash is asserted, it's computed independently in the test via
 * Node's own crypto for a hand-built string — that checks the
 * function does what it claims (concatenate -> encode -> MD5), not
 * that PayFast's servers would accept it. See DECISIONS.md for the
 * "PayFast's own signature tool" recommendation for pre-launch
 * verification against a real account.
 */
describe("payFastUrlEncode", () => {
  it("encodes a space as '+', not '%20'", () => {
    expect(payFastUrlEncode("John Doe")).toBe("John+Doe");
  });

  it("leaves alphanumerics and -_. unescaped", () => {
    expect(payFastUrlEncode("abc-123_XYZ.test")).toBe("abc-123_XYZ.test");
  });

  it("percent-encodes reserved/punctuation characters PHP's urlencode() does not treat as safe, in uppercase hex", () => {
    expect(payFastUrlEncode(":")).toBe("%3A");
    expect(payFastUrlEncode("/")).toBe("%2F");
    expect(payFastUrlEncode("@")).toBe("%40");
    expect(payFastUrlEncode("&")).toBe("%26");
    expect(payFastUrlEncode("=")).toBe("%3D");
  });

  it("percent-encodes characters RFC 3986 treats as unreserved but urlencode() does not (a known encodeURIComponent divergence)", () => {
    expect(payFastUrlEncode("!")).toBe("%21");
    expect(payFastUrlEncode("'")).toBe("%27");
    expect(payFastUrlEncode("(")).toBe("%28");
    expect(payFastUrlEncode(")")).toBe("%29");
    expect(payFastUrlEncode("*")).toBe("%2A");
    expect(payFastUrlEncode("~")).toBe("%7E");
  });

  it("encodes a full email address the way a checkout field would need it", () => {
    expect(payFastUrlEncode("john@doe.com")).toBe("john%40doe.com");
  });

  it("encodes each byte of a multi-byte UTF-8 character separately, matching urlencode()'s byte-oriented behavior", () => {
    // 'é' is 2 bytes in UTF-8: 0xC3 0xA9.
    expect(payFastUrlEncode("é")).toBe("%C3%A9");
  });
});

describe("buildPayFastParamString", () => {
  it("joins non-blank fields with '&' in the caller-supplied order, never alphabetized", () => {
    const result = buildPayFastParamString([
      ["merchant_id", "10000100"],
      ["merchant_key", "46f0cd694581a"],
      ["amount", "100.00"],
      ["item_name", "Test Product"],
    ]);
    expect(result).toBe("merchant_id=10000100&merchant_key=46f0cd694581a&amount=100.00&item_name=Test+Product");
  });

  it("omits blank/undefined/null fields entirely, rather than including them as 'key='", () => {
    const result = buildPayFastParamString([
      ["merchant_id", "10000100"],
      ["name_first", ""],
      ["name_last", undefined],
      ["email_address", null],
      ["amount", "100.00"],
    ]);
    expect(result).toBe("merchant_id=10000100&amount=100.00");
  });

  it("appends the passphrase as a trailing 'passphrase=' pair when provided", () => {
    const result = buildPayFastParamString([["amount", "100.00"]], "jt7NOE43FZPn");
    expect(result).toBe("amount=100.00&passphrase=jt7NOE43FZPn");
  });

  it("omits the passphrase pair entirely when none is provided", () => {
    const result = buildPayFastParamString([["amount", "100.00"]]);
    expect(result).toBe("amount=100.00");
  });

  it("trims whitespace from values before encoding, matching the documented trim() step", () => {
    const result = buildPayFastParamString([["item_name", "  Test Product  "]]);
    expect(result).toBe("item_name=Test+Product");
  });
});

describe("generatePayFastSignature", () => {
  it("is the MD5 of the exact parameter string this module itself builds (internal consistency, not an official vector)", () => {
    const fields: [string, string][] = [
      ["merchant_id", "10000100"],
      ["amount", "100.00"],
    ];
    const expectedString = buildPayFastParamString(fields, "jt7NOE43FZPn");
    const expectedHash = createHash("md5").update(expectedString).digest("hex");
    expect(generatePayFastSignature(fields, "jt7NOE43FZPn")).toBe(expectedHash);
  });

  it("produces a different signature when field order changes — proves order isn't normalized/alphabetized away", () => {
    const a = generatePayFastSignature([
      ["amount", "100.00"],
      ["item_name", "Test"],
    ]);
    const b = generatePayFastSignature([
      ["item_name", "Test"],
      ["amount", "100.00"],
    ]);
    expect(a).not.toBe(b);
  });

  it("produces a different signature when the passphrase changes", () => {
    const fields: [string, string][] = [["amount", "100.00"]];
    const withoutPassphrase = generatePayFastSignature(fields);
    const withPassphrase = generatePayFastSignature(fields, "some-passphrase");
    expect(withoutPassphrase).not.toBe(withPassphrase);
  });

  it("produces a different signature when any field value changes — proves the signature covers the amount, not just field names", () => {
    const a = generatePayFastSignature([["amount", "100.00"]]);
    const b = generatePayFastSignature([["amount", "1.00"]]);
    expect(a).not.toBe(b);
  });

  it("is a 32-character lowercase hex string", () => {
    const sig = generatePayFastSignature([["amount", "100.00"]]);
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("verifyPayFastSignature", () => {
  it("accepts a signature generated the same way it verifies", () => {
    const fields: [string, string][] = [
      ["m_payment_id", "SuperUnique1"],
      ["pf_payment_id", "1089250"],
      ["payment_status", "COMPLETE"],
      ["amount_gross", "200.00"],
      ["merchant_id", "10012577"],
    ];
    const signature = generatePayFastSignature(fields, "jt7NOE43FZPn");
    const posted: [string, string][] = [...fields, ["signature", signature]];
    expect(verifyPayFastSignature(posted, signature, "jt7NOE43FZPn")).toBe(true);
  });

  it("rejects a tampered amount even if the signature field itself is left unchanged", () => {
    const fields: [string, string][] = [
      ["m_payment_id", "SuperUnique1"],
      ["amount_gross", "200.00"],
    ];
    const signature = generatePayFastSignature(fields, "jt7NOE43FZPn");
    const tampered: [string, string][] = [
      ["m_payment_id", "SuperUnique1"],
      ["amount_gross", "1.00"], // attacker lowers the amount post-signing
      ["signature", signature],
    ];
    expect(verifyPayFastSignature(tampered, signature, "jt7NOE43FZPn")).toBe(false);
  });

  it("rejects a tampered payment_status", () => {
    const fields: [string, string][] = [["payment_status", "CANCELLED"]];
    const signature = generatePayFastSignature(fields, "jt7NOE43FZPn");
    const tampered: [string, string][] = [
      ["payment_status", "COMPLETE"], // attacker flips cancelled -> complete
      ["signature", signature],
    ];
    expect(verifyPayFastSignature(tampered, signature, "jt7NOE43FZPn")).toBe(false);
  });

  it("rejects a completely malformed/missing signature", () => {
    const fields: [string, string][] = [["amount_gross", "200.00"]];
    expect(verifyPayFastSignature(fields, "not-a-real-signature", "jt7NOE43FZPn")).toBe(false);
    expect(verifyPayFastSignature(fields, "", "jt7NOE43FZPn")).toBe(false);
  });

  it("rejects when the passphrase used to verify doesn't match the one used to sign", () => {
    const fields: [string, string][] = [["amount_gross", "200.00"]];
    const signature = generatePayFastSignature(fields, "correct-passphrase");
    const posted: [string, string][] = [...fields, ["signature", signature]];
    expect(verifyPayFastSignature(posted, signature, "wrong-passphrase")).toBe(false);
  });

  it("is case-insensitive on the signature comparison (PayFast's examples show lowercase hex, but comparison shouldn't be brittle to case)", () => {
    const fields: [string, string][] = [["amount_gross", "200.00"]];
    const signature = generatePayFastSignature(fields, "jt7NOE43FZPn");
    const posted: [string, string][] = [...fields, ["signature", signature.toUpperCase()]];
    expect(verifyPayFastSignature(posted, signature.toUpperCase(), "jt7NOE43FZPn")).toBe(true);
  });
});
