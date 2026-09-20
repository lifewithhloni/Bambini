import { describe, expect, it } from "vitest";
import { locationSchema } from "./validation";

const valid = {
  latitude: "-33.9249",
  longitude: "18.4241",
  suburb: "Gardens",
  city: "Cape Town",
  province: "Western Cape",
};

describe("locationSchema", () => {
  it("accepts a valid captured location", () => {
    const result = locationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBeCloseTo(-33.9249);
      expect(result.data.longitude).toBeCloseTo(18.4241);
    }
  });

  it("rejects a latitude outside -90..90, mirroring the DB CHECK constraint", () => {
    expect(locationSchema.safeParse({ ...valid, latitude: "95" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...valid, latitude: "-95" }).success).toBe(false);
  });

  it("rejects a longitude outside -180..180, mirroring the DB CHECK constraint", () => {
    expect(locationSchema.safeParse({ ...valid, longitude: "200" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...valid, longitude: "-200" }).success).toBe(false);
  });

  it("rejects a non-numeric or missing coordinate instead of silently defaulting to 0,0", () => {
    expect(locationSchema.safeParse({ ...valid, latitude: "" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...valid, latitude: "not-a-number" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...valid, longitude: null }).success).toBe(false);
  });

  it("requires suburb and city — no full street address is collected this phase", () => {
    expect(locationSchema.safeParse({ ...valid, suburb: "" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...valid, city: "" }).success).toBe(false);
    expect(Object.keys(valid)).not.toContain("formattedAddress");
  });

  it("treats province as optional, normalizing an empty string to null", () => {
    const result = locationSchema.safeParse({ ...valid, province: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.province).toBeNull();
  });
});
