import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().min(1, "Email is required").email("Enter a valid email address");

// Supabase's own minimum is 6; Bambini requires 8 as a slightly stronger
// baseline. Not doing complexity rules (upper/lower/digit/symbol) here —
// length is the strongest single predictor of password strength, and
// complexity rules mostly just push people toward predictable patterns.
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

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
