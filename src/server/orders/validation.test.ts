import { describe, expect, it } from "vitest";
import { fulfilmentTypeSchema } from "./validation";

describe("fulfilmentTypeSchema", () => {
  it("accepts collection and delivery", () => {
    expect(fulfilmentTypeSchema.safeParse("collection").success).toBe(true);
    expect(fulfilmentTypeSchema.safeParse("delivery").success).toBe(true);
  });

  it("rejects anything else, including an arbitrary/adversarial string", () => {
    expect(fulfilmentTypeSchema.safeParse("").success).toBe(false);
    expect(fulfilmentTypeSchema.safeParse("teleport").success).toBe(false);
    expect(fulfilmentTypeSchema.safeParse(null).success).toBe(false);
    expect(fulfilmentTypeSchema.safeParse(undefined).success).toBe(false);
    expect(fulfilmentTypeSchema.safeParse("collection); DROP TABLE orders; --").success).toBe(false);
  });
});
