import { z } from "zod";
import { SLUG_PATTERN } from "./slug";

const normalizeEmpty = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);

export const businessNameSchema = z.string().trim().min(1, "Business name is required").max(200, "Business name is too long");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Choose a URL of at least 3 characters")
  .max(60, "That URL is too long")
  .regex(SLUG_PATTERN, "Use only lowercase letters, numbers, and hyphens (e.g. little-treasures)");

export const createBusinessSchema = z.object({
  businessName: businessNameSchema,
  slug: slugSchema,
  registrationNumber: z.preprocess(normalizeEmpty, z.string().trim().max(100).optional()).transform((v) => v ?? null),
  vatNumber: z.preprocess(normalizeEmpty, z.string().trim().max(100).optional()).transform((v) => v ?? null),
  description: z.preprocess(normalizeEmpty, z.string().trim().max(2000, "Description is too long").optional()).transform((v) => v ?? null),
});

export const updateBusinessSchema = z.object({
  businessName: businessNameSchema,
  description: z.preprocess(normalizeEmpty, z.string().trim().max(2000, "Description is too long").optional()).transform((v) => v ?? null),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
