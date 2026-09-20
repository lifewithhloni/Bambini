import { describe, expect, it } from "vitest";
import { PAGE_SIZE, clampPage, offsetFor, totalPagesFor } from "./pagination";

describe("offsetFor", () => {
  it("page 1 is offset 0", () => {
    expect(offsetFor(1, 24)).toBe(0);
  });
  it("page 2 is offset pageSize", () => {
    expect(offsetFor(2, 24)).toBe(24);
  });
  it("page 3 with a custom page size", () => {
    expect(offsetFor(3, 10)).toBe(20);
  });
  it("never goes negative for a page below 1", () => {
    expect(offsetFor(0, 24)).toBe(0);
    expect(offsetFor(-5, 24)).toBe(0);
  });
  it("defaults to the standard PAGE_SIZE", () => {
    expect(offsetFor(2)).toBe(PAGE_SIZE);
  });
});

describe("totalPagesFor", () => {
  it("computes an exact multiple correctly", () => {
    expect(totalPagesFor(48, 24)).toBe(2);
  });
  it("rounds up for a partial last page", () => {
    expect(totalPagesFor(49, 24)).toBe(3);
    expect(totalPagesFor(1, 24)).toBe(1);
  });
  it("is always at least 1, even for zero results — an empty result set is still 'page 1 of 1'", () => {
    expect(totalPagesFor(0, 24)).toBe(1);
  });
});

describe("clampPage", () => {
  it("passes through an in-range page", () => {
    expect(clampPage(2, 5)).toBe(2);
  });
  it("clamps a page below 1 up to 1", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });
  it("clamps a page beyond the last page down to it", () => {
    expect(clampPage(99, 5)).toBe(5);
  });
  it("never returns less than 1 even when totalPages is 0", () => {
    expect(clampPage(5, 0)).toBe(1);
  });
});
