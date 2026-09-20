import { describe, expect, it } from "vitest";
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS_KM, isValidRadiusKm, parseRadiusKm } from "./radius";

describe("radius allowlist", () => {
  it("exposes exactly the four supported radius filters", () => {
    expect(RADIUS_OPTIONS_KM).toEqual([5, 10, 25, 50]);
  });

  it("isValidRadiusKm accepts only the allowlisted values", () => {
    for (const km of RADIUS_OPTIONS_KM) expect(isValidRadiusKm(km)).toBe(true);
    expect(isValidRadiusKm(15)).toBe(false);
    expect(isValidRadiusKm(2000)).toBe(false);
    expect(isValidRadiusKm(0)).toBe(false);
  });

  it("parseRadiusKm passes through a valid string value", () => {
    expect(parseRadiusKm("25")).toBe(25);
  });

  it("parseRadiusKm falls back to the default for anything not on the allowlist, never throwing", () => {
    expect(parseRadiusKm("2000")).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("not-a-number")).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm(null)).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm(undefined)).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("")).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("; DROP TABLE products; --")).toBe(DEFAULT_RADIUS_KM);
    // A leading valid-looking number is parsed and then still checked
    // against the allowlist — 5 is valid, so this is a real 5 km
    // request, not arbitrary SQL reaching the database (the RPC call
    // itself is always a bound parameter, never string-built).
    expect(parseRadiusKm("5; DROP TABLE products; --")).toBe(5);
  });
});
