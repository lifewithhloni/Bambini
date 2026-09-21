import { createHash } from "node:crypto";

/**
 * PHP's urlencode() (which PayFast's own signature algorithm is
 * documented and reference-implemented against — see
 * developers.payfast.co.za/docs, "Create security signature") is
 * *not* the same encoding as JavaScript's encodeURIComponent(), and
 * the two disagree on more than just spaces (e.g. `!'()*` are left
 * unescaped by encodeURIComponent as RFC 3986 "unreserved" characters,
 * but urlencode() does escape them; there's genuine uncertainty about
 * whether `~` is escaped by urlencode() depending on PHP version/
 * history). Rather than patching encodeURIComponent's output for each
 * known divergence — fragile, since it silently assumes there are no
 * *other* differences — this implements PHP's documented urlencode()
 * rule directly, byte by byte: alphanumerics and `-_.` pass through
 * unchanged, a space becomes `+`, everything else (including each byte
 * of a multi-byte UTF-8 character, matching urlencode()'s own
 * byte-oriented behavior) becomes an uppercase `%XX`. This is the
 * actual documented safe-character rule, not an inference from how
 * some other encoder happens to behave.
 */
const PAYFAST_SAFE_BYTE = /[A-Za-z0-9\-_.]/;

export function payFastUrlEncode(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let result = "";
  for (const byte of bytes) {
    if (byte === 0x20) {
      result += "+";
      continue;
    }
    const char = String.fromCharCode(byte);
    if (PAYFAST_SAFE_BYTE.test(char)) {
      result += char;
    } else {
      result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return result;
}

/**
 * Builds the exact parameter string PayFast's signature is computed
 * over: `key=value` pairs joined with `&`, in caller-supplied order
 * (PayFast's docs are explicit that this must be *field declaration
 * order*, never alphabetical — "Do not use the API signature format,
 * which uses alphabetical ordering!"), values PHP-urlencoded,
 * blank/undefined values omitted entirely per "Concatenation of the
 * name value pairs of all the non-blank variables" — a key with an
 * empty value is dropped, not included as `key=`.
 *
 * `fields` is an array of [key, value] pairs rather than a plain object
 * specifically so the caller's insertion order is preserved exactly —
 * a JS object's key order is usually insertion order in practice, but
 * an array of pairs makes that order a deliberate, visible choice
 * instead of an accident of engine behavior, which matters when the
 * order itself is part of what's being tested/verified.
 */
export function buildPayFastParamString(fields: [string, string | undefined | null][], passphrase?: string): string {
  const parts = fields
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${payFastUrlEncode(String(value).trim())}`);

  if (passphrase) {
    parts.push(`passphrase=${payFastUrlEncode(passphrase.trim())}`);
  }

  return parts.join("&");
}

/** MD5 of the built parameter string, lower-case hex — matches the `signature` field PayFast both sends and expects (their own examples show lower-case MD5 hex). */
export function generatePayFastSignature(fields: [string, string | undefined | null][], passphrase?: string): string {
  const paramString = buildPayFastParamString(fields, passphrase);
  return createHash("md5").update(paramString).digest("hex");
}

/**
 * Verifies an ITN's signature by rebuilding the parameter string from
 * the *raw, already-parsed* posted fields in the order they arrived —
 * PayFast's ITN validation docs rebuild the string from the posted
 * `$_POST` array (which preserves original submission order for a
 * regular form POST), not from a fixed field-declaration order the way
 * the outbound checkout signature is built. `postedFields` must
 * therefore already be in wire order (see webhook route handler, which
 * parses the raw body with URLSearchParams rather than an
 * order-losing object).
 */
export function verifyPayFastSignature(
  postedFields: [string, string][],
  receivedSignature: string,
  passphrase?: string,
): boolean {
  const withoutSignature = postedFields.filter(([key]) => key !== "signature");
  const expected = generatePayFastSignature(withoutSignature, passphrase);
  return expected.toLowerCase() === receivedSignature.trim().toLowerCase();
}
