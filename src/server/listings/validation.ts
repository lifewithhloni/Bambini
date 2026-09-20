import { z } from "zod";
import { parseRandToCents } from "./price";

export const LISTING_CONDITIONS = ["like_new", "excellent", "good", "fair"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

const priceSchema = z
  .string()
  .trim()
  .min(1, "Price is required")
  .transform((val, ctx) => {
    const cents = parseRandToCents(val);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter a price like 250 or 250.50" });
      return z.NEVER;
    }
    if (cents > 100_000_000) {
      ctx.addIssue({ code: "custom", message: "That price looks too high — check the amount" });
      return z.NEVER;
    }
    return cents;
  });

// FormData checkboxes arrive as "on" when checked, and are simply
// absent when unchecked — never "false". `FormData.get()` returns
// `null` (not `undefined`) for a missing field, and zod's own
// `.optional()` only special-cases a key that's actually absent from
// the input object, not one present with value `null` — so every
// "optional" field below is normalized with `z.preprocess()`, which
// runs on the raw value (including a genuinely missing key, which
// zod hands to it as `undefined`) before the real type check.
const normalizeEmpty = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);

const checkboxSchema = z.preprocess(normalizeEmpty, z.enum(["on", "true"]).optional()).transform((v) => v !== undefined);

const nullableUuid = z.preprocess(normalizeEmpty, z.string().trim().uuid().optional());

const nullableSellerType = z.preprocess(
  (v) => (normalizeEmpty(v) === undefined ? "parent" : v),
  z.enum(["parent", "business"]),
);

const baseListingFields = {
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  categoryId: z.string().trim().uuid("Choose a category"),
  condition: z.enum(LISTING_CONDITIONS, { message: "Choose a condition" }),
  priceCents: priceSchema,
  description: z
    .preprocess(normalizeEmpty, z.string().trim().max(2000, "Description is too long").optional())
    .transform((v) => v ?? null),
  collectionAvailable: checkboxSchema,
  deliveryAvailable: checkboxSchema,
};

export const createListingSchema = z
  .object({
    ...baseListingFields,
    // Absent/parent by default — the create form doesn't expose a
    // business-storefront toggle yet (business onboarding UI is Phase
    // 7), but the schema and the action underneath it are already
    // seller_type-aware so business-owned listings are a real,
    // server-verified path today, not a placeholder for later.
    sellerType: nullableSellerType,
    businessId: nullableUuid,
  })
  .refine((data) => data.collectionAvailable || data.deliveryAvailable, {
    message: "Offer at least one of collection or delivery",
    path: ["collectionAvailable"],
  })
  .refine((data) => data.sellerType !== "business" || !!data.businessId, {
    message: "Choose which business this listing belongs to",
    path: ["businessId"],
  });

export const updateListingSchema = z
  .object(baseListingFields)
  .refine((data) => data.collectionAvailable || data.deliveryAvailable, {
    message: "Offer at least one of collection or delivery",
    path: ["collectionAvailable"],
  });

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
