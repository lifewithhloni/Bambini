import { z } from "zod";
import { PHONE_LIMITS } from "../types";

/**
 * The part of Supabase's Send SMS Hook payload this endpoint relies on.
 * Everything else is ignored — in particular `user.phone`, which for a
 * phone_change is the user's OLD number (or empty) and must NEVER be used
 * as the destination. The destination is `sms.phone`, the number Auth
 * itself says this code is for.
 *
 * `user.email` is required: Bambini accounts are created by email signup,
 * so a payload for a user with no email (a phone-only signup attempt made
 * directly against the Auth API, or an anonymous user) must not spend SMS.
 */
const payloadSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().trim().min(3),
    is_anonymous: z.boolean().optional(),
  }),
  sms: z.object({
    phone: z.string().min(1),
    otp: z.string().regex(new RegExp(`^\\d{${PHONE_LIMITS.otpLength}}$`)),
  }),
});

export type HookPayload = { userId: string; rawPhone: string; otp: string };

export type ParsePayloadResult = { ok: true; payload: HookPayload } | { ok: false; reason: "malformed" | "anonymous" };

export function parseHookPayload(json: unknown): ParsePayloadResult {
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  if (parsed.data.user.is_anonymous === true) return { ok: false, reason: "anonymous" };
  return { ok: true, payload: { userId: parsed.data.user.id, rawPhone: parsed.data.sms.phone, otp: parsed.data.sms.otp } };
}
