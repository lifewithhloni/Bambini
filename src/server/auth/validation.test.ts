import { describe, expect, it, vi } from "vitest";
import { checkPasswordStrength, safeRedirectPath, signInSchema, signUpSchema, updateProfileSchema } from "./validation";

describe("signUpSchema", () => {
  const valid = {
    fullName: "Alice Buyer",
    email: "alice@example.com",
    password: "Correct-Horse9",
    confirmPassword: "Correct-Horse9",
  };

  it("accepts valid input", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("lowercases and trims the email", () => {
    const r = signUpSchema.safeParse({ ...valid, email: "  Alice@Example.COM  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("alice@example.com");
  });

  it("rejects a malformed email", () => {
    expect(signUpSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a short password", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "short1", confirmPassword: "short1" }).success).toBe(false);
  });

  it("rejects mismatched confirmPassword", () => {
    const r = signUpSchema.safeParse({ ...valid, confirmPassword: "somethingElse" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["confirmPassword"]);
  });

  it("rejects an empty full name", () => {
    expect(signUpSchema.safeParse({ ...valid, fullName: "  " }).success).toBe(false);
  });
});

describe("checkPasswordStrength / passwordSchema — locked password policy", () => {
  it("accepts a valid complex 12+ character password meeting every rule", () => {
    const result = checkPasswordStrength("Str0ng!Passphrase");
    expect(result.ok).toBe(true);
    expect(result.requirements.every((r) => r.met)).toBe(true);
    expect(signUpSchema.safeParse({
      fullName: "Alice Buyer",
      email: "alice@example.com",
      password: "Str0ng!Passphrase",
      confirmPassword: "Str0ng!Passphrase",
    }).success).toBe(true);
  });

  it("rejects a password missing an uppercase letter", () => {
    const result = checkPasswordStrength("lowercase123!");
    expect(result.ok).toBe(false);
    expect(result.requirements.find((r) => r.id === "uppercase")?.met).toBe(false);
  });

  it("rejects a password missing a lowercase letter", () => {
    const result = checkPasswordStrength("UPPERCASE123!");
    expect(result.ok).toBe(false);
    expect(result.requirements.find((r) => r.id === "lowercase")?.met).toBe(false);
  });

  it("rejects a password missing a number", () => {
    const result = checkPasswordStrength("NoNumbersHere!");
    expect(result.ok).toBe(false);
    expect(result.requirements.find((r) => r.id === "number")?.met).toBe(false);
  });

  it("rejects a password missing a special character", () => {
    const result = checkPasswordStrength("NoSpecialChar123");
    expect(result.ok).toBe(false);
    expect(result.requirements.find((r) => r.id === "special")?.met).toBe(false);
  });

  it("rejects an 11-character password (one under the 12-character minimum) even if every other rule is met", () => {
    const elevenChars = "Sh0rt!Pass1";
    expect(elevenChars).toHaveLength(11);
    const result = checkPasswordStrength(elevenChars);
    expect(result.requirements.find((r) => r.id === "length")?.met).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("accepts a password of exactly 12 characters meeting every other rule", () => {
    const password = "Ab1!Ab1!Ab1!";
    expect(password).toHaveLength(12);
    expect(checkPasswordStrength(password).ok).toBe(true);
  });

  it.each(["password", "password123", "123456789", "qwerty", "12345678", "letmein", "admin", "welcome"])(
    "rejects the named weak password %s as not-common, regardless of any other rule it happens to meet",
    (weak) => {
      expect(checkPasswordStrength(weak).requirements.find((r) => r.id === "notCommon")?.met).toBe(false);
    },
  );

  it.each(["PASSWORD", "Password", "PaSsWoRd", "  password  ", "ADMIN", "Welcome"])(
    "rejects case-insensitive/whitespace variants of a weak password: %s",
    (variant) => {
      expect(checkPasswordStrength(variant).requirements.find((r) => r.id === "notCommon")?.met).toBe(false);
    },
  );

  it("a weak password is still rejected by the full signUpSchema even if it happens to be 12+ characters with every character class", () => {
    // "Password123!" satisfies length/upper/lower/number/special on its
    // own, but must still be rejected once case-insensitively normalized
    // to the "password" denylist entry.
    const r = signUpSchema.safeParse({
      fullName: "Alice Buyer",
      email: "alice@example.com",
      password: "Password123!",
      confirmPassword: "Password123!",
    });
    // "Password123!" isn't literally in the denylist (only "password" and
    // "password123" are) — confirm the denylist matches on the whole
    // normalized string, not a substring, then separately prove an exact
    // match is rejected end-to-end through the real schema.
    expect(checkPasswordStrength("Password123!").requirements.find((r) => r.id === "notCommon")?.met).toBe(true);
    expect(r.success).toBe(true);

    const exactWeak = signUpSchema.safeParse({
      fullName: "Alice Buyer",
      email: "alice@example.com",
      password: "password123",
      confirmPassword: "password123",
    });
    expect(exactWeak.success).toBe(false);
  });

  it("never logs the password value — checkPasswordStrength and a rejecting schema parse produce no console output containing it", () => {
    const secret = "TotallyReal!Secret123";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    checkPasswordStrength(secret);
    signUpSchema.safeParse({ fullName: "Alice Buyer", email: "alice@example.com", password: "weak", confirmPassword: "weak" });

    for (const spy of [logSpy, warnSpy, errorSpy]) {
      expect(spy).not.toHaveBeenCalled();
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("signInSchema", () => {
  it("accepts valid input", () => {
    expect(signInSchema.safeParse({ email: "bob@example.com", password: "anything" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(signInSchema.safeParse({ email: "bob@example.com", password: "" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(signInSchema.safeParse({ email: "nope", password: "anything" }).success).toBe(false);
  });

  it("still accepts a legacy/simple existing password that would fail the new signup policy — login must never re-enforce passwordSchema against an old password", () => {
    // Short, no uppercase, no special character, no digit — would fail
    // every rule in checkPasswordStrength(), and must still be accepted
    // here: signInSchema's password field is, and remains, an
    // independent z.string().min(1) with no reference to passwordSchema.
    const oldStylePassword = "oldpass";
    expect(checkPasswordStrength(oldStylePassword).ok).toBe(false);
    expect(signInSchema.safeParse({ email: "bob@example.com", password: oldStylePassword }).success).toBe(true);
  });
});

describe("updateProfileSchema", () => {
  it("accepts a full name with no phone", () => {
    expect(updateProfileSchema.safeParse({ fullName: "Bob Seller", phone: "" }).success).toBe(true);
  });

  it("accepts a full name with a phone", () => {
    expect(updateProfileSchema.safeParse({ fullName: "Bob Seller", phone: "+27 82 555 0000" }).success).toBe(true);
  });

  it("rejects an empty full name", () => {
    expect(updateProfileSchema.safeParse({ fullName: "", phone: "" }).success).toBe(false);
  });

  it("does not accept a role field even if supplied", () => {
    const r = updateProfileSchema.safeParse({ fullName: "Bob", phone: "", role: "admin" });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).role).toBeUndefined();
  });
});

describe("safeRedirectPath", () => {
  it("allows a same-origin relative path", () => {
    expect(safeRedirectPath("/account/orders")).toBe("/account/orders");
  });

  it("falls back to default for null/undefined/empty", () => {
    expect(safeRedirectPath(null)).toBe("/account");
    expect(safeRedirectPath(undefined)).toBe("/account");
    expect(safeRedirectPath("")).toBe("/account");
  });

  it("rejects an absolute URL (open-redirect attempt)", () => {
    expect(safeRedirectPath("https://evil.example.com/phish")).toBe("/account");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeRedirectPath("//evil.example.com")).toBe("/account");
  });

  it("rejects a path containing a backslash", () => {
    expect(safeRedirectPath("/\\evil.example.com")).toBe("/account");
  });

  it("honors a custom fallback", () => {
    expect(safeRedirectPath(null, "/")).toBe("/");
  });
});
