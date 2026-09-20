import { describe, expect, it } from "vitest";
import { safeRedirectPath, signInSchema, signUpSchema, updateProfileSchema } from "./validation";

describe("signUpSchema", () => {
  const valid = {
    fullName: "Alice Buyer",
    email: "alice@example.com",
    password: "correcthorse",
    confirmPassword: "correcthorse",
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
