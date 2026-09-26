import { describe, expect, it } from "vitest";
import { orderMatchesFilter } from "./orderBucket";

describe("orderMatchesFilter", () => {
  it("'all' matches every status", () => {
    expect(orderMatchesFilter("pending_payment", "all")).toBe(true);
    expect(orderMatchesFilter("completed", "all")).toBe(true);
    expect(orderMatchesFilter("some_future_status", "all")).toBe(true);
  });

  it("'active' matches in-progress statuses", () => {
    for (const status of ["pending_payment", "confirmed", "ready_for_collection", "awaiting_delivery", "in_transit", "disputed"]) {
      expect(orderMatchesFilter(status, "active")).toBe(true);
    }
  });

  it("'active' excludes completed/cancelled/refunded", () => {
    for (const status of ["completed", "cancelled", "refunded"]) {
      expect(orderMatchesFilter(status, "active")).toBe(false);
    }
  });

  it("'completed' matches completed/cancelled/refunded", () => {
    for (const status of ["completed", "cancelled", "refunded"]) {
      expect(orderMatchesFilter(status, "completed")).toBe(true);
    }
  });

  it("'completed' excludes active statuses", () => {
    expect(orderMatchesFilter("confirmed", "completed")).toBe(false);
  });
});
