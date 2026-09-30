import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().min(1, "Email is required").email("Enter a valid email address");

// Deliberately small and deterministic — exact, documented examples only,
// never a large breached-password list or an entropy scorer (zxcvbn etc.).
// Compared case-insensitively so "Password123"/"PASSWORD" are also caught.
const WEAK_PASSWORDS = new Set(["password", "password123", "123456789", "qwerty", "12345678", "letmein", "admin", "welcome"]);

export const PASSWORD_MIN_LENGTH = 12;

export type PasswordRequirement = {
  id: "length" | "uppercase" | "lowercase" | "number" | "special" | "notCommon";
  label: string;
  met: boolean;
};

/**
 * The one shared source of truth for Bambini's password policy —
 * imported by passwordSchema below (server-authoritative) AND directly by
 * the signup page's live checklist (src/app/signup/page.tsx), so the two
 * can never drift. This file has no "server-only" guard, so it's already
 * safe to import from a client component. Takes and returns the password
 * only in memory; never logs it, never persists it — the caller is
 * responsible for the same discipline (see submitIdentityVerification.ts's
 * equivalent "message bodies/ID numbers are never logged" precedent
 * elsewhere in this codebase).
 */
export function checkPasswordStrength(password: string): { ok: boolean; requirements: PasswordRequirement[] } {
  const requirements: PasswordRequirement[] = [
    { id: "length", label: `be at least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: "uppercase", label: "include an uppercase letter (A-Z)", met: /[A-Z]/.test(password) },
    { id: "lowercase", label: "include a lowercase letter (a-z)", met: /[a-z]/.test(password) },
    { id: "number", label: "include a number (0-9)", met: /[0-9]/.test(password) },
    { id: "special", label: "include a special character", met: /[^A-Za-z0-9]/.test(password) },
    { id: "notCommon", label: "not be a commonly used password", met: !WEAK_PASSWORDS.has(password.trim().toLowerCase()) },
  ];
  return { ok: requirements.every((r) => r.met), requirements };
}

// Every unmet requirement is listed in one message — the live checklist on
// the signup page is the primary UX, this is the fallback for anything
// that reaches the server without going through it (JS disabled, a direct
// request). Never includes the password value itself, only which rules it
// failed.
export const passwordSchema = z.string().superRefine((password, ctx) => {
  const { ok, requirements } = checkPasswordStrength(password);
  if (!ok) {
    const unmet = requirements.filter((r) => !r.met).map((r) => r.label);
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Password must ${unmet.join(", ")}.` });
  }
});

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, "Full name is required")
  .max(200, "Full name is too long");

export const signUpSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const updateProfileSchema = z.object({
  fullName: fullNameSchema,
  phone: z
    .string()
    .trim()
    .max(30, "Phone number is too long")
    .optional()
    .or(z.literal("")),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Guards the post-login redirect target against becoming an open
 * redirect: only a same-origin, relative path is ever honored. Anything
 * else (an absolute URL, a protocol-relative "//evil.com", a stray
 * backslash) falls back to the default.
 */
export function safeRedirectPath(path: FormDataEntryValue | string | null | undefined, fallback = "/account"): string {
  if (typeof path !== "string" || path.length === 0) return fallback;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}
