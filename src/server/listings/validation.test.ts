import { describe, expect, it } from "vitest";
import { createListingSchema, updateListingSchema } from "./validation";

const validFields = {
  title: "Baby Stroller",
  categoryId: "11111111-1111-4111-8111-111111111111",
  condition: "good",
  priceCents: "500",
  description: "Gently used stroller",
  collectionAvailable: "on",
  deliveryAvailable: undefined,
};

describe("createListingSchema", () => {
  it("accepts valid input and converts price to integer cents", () => {
    const r = createListingSchema.safeParse(validFields);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.priceCents).toBe(50000);
      expect(r.data.collectionAvailable).toBe(true);
      expect(r.data.deliveryAvailable).toBe(false);
      expect(r.data.sellerType).toBe("parent");
    }
  });

  it("defaults to sellerType 'parent' with no businessId", () => {
    const r = createListingSchema.safeParse(validFields);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.businessId).toBeUndefined();
  });

  it("rejects a missing title", () => {
    expect(createListingSchema.safeParse({ ...validFields, title: "" }).success).toBe(false);
  });

  it("rejects an invalid category id", () => {
    expect(createListingSchema.safeParse({ ...validFields, categoryId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an invalid condition value", () => {
    expect(createListingSchema.safeParse({ ...validFields, condition: "new" }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...validFields, condition: "brand-new" }).success).toBe(false);
  });

  it("accepts every real condition value", () => {
    for (const condition of ["like_new", "excellent", "good", "fair"]) {
      expect(createListingSchema.safeParse({ ...validFields, condition }).success).toBe(true);
    }
  });

  it("rejects an unparseable price", () => {
    expect(createListingSchema.safeParse({ ...validFields, priceCents: "abc" }).success).toBe(false);
  });

  it("requires at least one of collection or delivery to be available", () => {
    const r = createListingSchema.safeParse({ ...validFields, collectionAvailable: undefined, deliveryAvailable: undefined });
    expect(r.success).toBe(false);
  });

  it("allows a description to be omitted", () => {
    const { description: _description, ...rest } = validFields;
    const r = createListingSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeNull();
  });

  it("requires a businessId when sellerType is business", () => {
    const r = createListingSchema.safeParse({ ...validFields, sellerType: "business" });
    expect(r.success).toBe(false);
  });

  it("accepts a business listing with a businessId", () => {
    const r = createListingSchema.safeParse({
      ...validFields,
      sellerType: "business",
      businessId: "22222222-2222-4222-8222-222222222222",
    });
    expect(r.success).toBe(true);
  });

  it("never accepts a seller/owner id field — a client-supplied one is silently dropped, not trusted", () => {
    const r = createListingSchema.safeParse({
      ...validFields,
      sellerId: "attacker-controlled",
      sellerProfileId: "attacker-controlled",
      ownerId: "attacker-controlled",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data as Record<string, unknown>).not.toHaveProperty("sellerId");
      expect(r.data as Record<string, unknown>).not.toHaveProperty("sellerProfileId");
      expect(r.data as Record<string, unknown>).not.toHaveProperty("ownerId");
    }
  });
});

describe("updateListingSchema", () => {
  it("accepts valid input (no seller/business fields — ownership isn't editable here)", () => {
    const r = updateListingSchema.safeParse(validFields);
    expect(r.success).toBe(true);
  });

  it("has no status field — a client-supplied one is silently dropped, status changes go through the dedicated transition action instead", () => {
    const r = updateListingSchema.safeParse({ ...validFields, status: "published" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data as Record<string, unknown>).not.toHaveProperty("status");
  });
});
