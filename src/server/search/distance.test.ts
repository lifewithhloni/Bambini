import { describe, expect, it } from "vitest";
import { formatDistanceKm } from "./distance";

describe("formatDistanceKm", () => {
  it("formats sub-kilometre distances in rounded metres, never raw fractional km", () => {
    expect(formatDistanceKm(0.03)).toBe("50 m away");
    expect(formatDistanceKm(0.42)).toBe("400 m away");
    expect(formatDistanceKm(0.9)).toBe("900 m away");
  });

  it("formats kilometre-plus distances to one decimal place, never excessive precision", () => {
    expect(formatDistanceKm(3.427183)).toBe("3.4 km away");
    expect(formatDistanceKm(1)).toBe("1.0 km away");
    expect(formatDistanceKm(49.96)).toBe("50.0 km away");
  });

  it("never shows 0 m away — the smallest displayed value is 50 m", () => {
    expect(formatDistanceKm(0.001)).toBe("50 m away");
    expect(formatDistanceKm(0)).toBe("50 m away");
  });

  it("returns an empty string for invalid input instead of throwing or showing garbage", () => {
    expect(formatDistanceKm(Number.NaN)).toBe("");
    expect(formatDistanceKm(-1)).toBe("");
    expect(formatDistanceKm(Number.POSITIVE_INFINITY)).toBe("");
  });
});
