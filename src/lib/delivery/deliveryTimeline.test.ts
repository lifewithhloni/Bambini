import { describe, expect, it } from "vitest";
import { buildDeliveryTimeline } from "./deliveryTimeline";

describe("buildDeliveryTimeline", () => {
  it("marks nothing done while booking is still pending", () => {
    const steps = buildDeliveryTimeline("pending");
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps).toHaveLength(4);
  });

  it("marks only 'booked' done once booked", () => {
    const steps = buildDeliveryTimeline("booked");
    expect(steps.find((s) => s.key === "booked")?.done).toBe(true);
    expect(steps.find((s) => s.key === "collected_by_courier")?.done).toBe(false);
  });

  it("marks every step up to and including the current one as done, never steps after it", () => {
    const steps = buildDeliveryTimeline("in_transit");
    expect(steps.find((s) => s.key === "booked")?.done).toBe(true);
    expect(steps.find((s) => s.key === "collected_by_courier")?.done).toBe(true);
    expect(steps.find((s) => s.key === "in_transit")?.done).toBe(true);
    expect(steps.find((s) => s.key === "delivered")?.done).toBe(false);
  });

  it("marks every step done once delivered", () => {
    const steps = buildDeliveryTimeline("delivered");
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it("returns an empty list for a failed delivery — never shown as a step in the positive progression", () => {
    expect(buildDeliveryTimeline("failed")).toEqual([]);
  });

  it("returns an empty list for a cancelled delivery", () => {
    expect(buildDeliveryTimeline("cancelled")).toEqual([]);
  });
});
